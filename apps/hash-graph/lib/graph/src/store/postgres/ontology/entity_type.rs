use std::{borrow::Borrow, collections::HashMap};

use async_trait::async_trait;
use error_stack::{IntoReport, Result, ResultExt};
use type_system::EntityType;

use crate::{
    ontology::{EntityTypeQueryPath, EntityTypeWithMetadata, OntologyElementMetadata},
    provenance::RecordCreatedById,
    store::{
        crud::Read,
        error::DeletionError,
        postgres::{ontology::OntologyId, query::ReferenceTable, TraversalContext},
        query::{Filter, FilterExpression, ParameterList},
        AsClient, ConflictBehavior, EntityTypeStore, InsertionError, PostgresStore, QueryError,
        Record, UpdateError,
    },
    subgraph::{
        edges::{EdgeDirection, GraphResolveDepths, OntologyEdgeKind},
        identifier::{EntityTypeVertexId, PropertyTypeVertexId},
        query::StructuralQuery,
        temporal_axes::QueryTemporalAxes,
        Subgraph,
    },
};

impl<C: AsClient> PostgresStore<C> {
    pub(crate) async fn read_entity_types_by_ids(
        &self,
        vertex_ids: impl IntoIterator<Item = EntityTypeVertexId> + Send,
        temporal_axes: &QueryTemporalAxes,
    ) -> Result<Vec<EntityTypeWithMetadata>, QueryError> {
        let ids = vertex_ids
            .into_iter()
            .map(|id| format!("{}v/{}", id.base_id, id.revision_id.inner()))
            .collect::<Vec<_>>();

        <Self as Read<EntityTypeWithMetadata>>::read_vec(
            self,
            &Filter::<EntityTypeWithMetadata>::In(
                FilterExpression::Path(EntityTypeQueryPath::VersionedUrl),
                ParameterList::VersionedUrls(&ids),
            ),
            Some(temporal_axes),
        )
        .await
    }

    /// Internal method to read a [`EntityTypeWithMetadata`] into four [`TraversalContext`]s.
    ///
    /// This is used to recursively resolve a type, so the result can be reused.
    #[tracing::instrument(level = "trace", skip(self, traversal_context, subgraph))]
    pub(crate) async fn traverse_entity_types(
        &self,
        mut entity_type_queue: Vec<(EntityTypeVertexId, GraphResolveDepths)>,
        traversal_context: &mut TraversalContext,
        subgraph: &mut Subgraph,
    ) -> Result<(), QueryError> {
        let mut property_type_queue = Vec::new();

        while !entity_type_queue.is_empty() {
            let mut edges_to_traverse =
                HashMap::<OntologyEdgeKind, (Vec<_>, Vec<_>, Vec<_>)>::new();

            #[expect(clippy::iter_with_drain, reason = "false positive, vector is reused")]
            for (entity_type_vertex_id, graph_resolve_depths) in entity_type_queue.drain(..) {
                for edge_kind in [
                    OntologyEdgeKind::ConstrainsPropertiesOn,
                    OntologyEdgeKind::InheritsFrom,
                    OntologyEdgeKind::ConstrainsLinksOn,
                    OntologyEdgeKind::ConstrainsLinkDestinationsOn,
                ] {
                    if let Some(new_graph_resolve_depths) = graph_resolve_depths
                        .decrement_depth_for_edge(edge_kind, EdgeDirection::Outgoing)
                    {
                        let entry = edges_to_traverse.entry(edge_kind).or_default();
                        entry.0.push(entity_type_vertex_id.base_id.to_string());
                        entry.1.push(entity_type_vertex_id.revision_id);
                        entry.2.push(new_graph_resolve_depths);
                    }
                }
            }

            if let Some((base_ids, versions, resolve_depths)) =
                edges_to_traverse.get(&OntologyEdgeKind::ConstrainsPropertiesOn)
            {
                property_type_queue.extend(
                    self.read_ontology_edges(
                        base_ids,
                        versions,
                        ReferenceTable::EntityTypeConstrainsPropertiesOn,
                    )
                    .await?
                    .map(|(source, target, index)| {
                        let source_vertex_id = EntityTypeVertexId::from(source);
                        let target_vertex_id = PropertyTypeVertexId::from(target);

                        traversal_context
                            .property_type_ids
                            .insert(target_vertex_id.clone());

                        subgraph.insert_edge(
                            &source_vertex_id,
                            OntologyEdgeKind::ConstrainsPropertiesOn,
                            EdgeDirection::Outgoing,
                            target_vertex_id.clone(),
                        );

                        (target_vertex_id, resolve_depths[index])
                    }),
                );
            }

            for (edge_kind, table) in [
                (
                    OntologyEdgeKind::InheritsFrom,
                    ReferenceTable::EntityTypeInheritsFrom,
                ),
                (
                    OntologyEdgeKind::ConstrainsLinksOn,
                    ReferenceTable::EntityTypeConstrainsLinksOn,
                ),
                (
                    OntologyEdgeKind::ConstrainsLinkDestinationsOn,
                    ReferenceTable::EntityTypeConstrainsLinkDestinationsOn,
                ),
            ] {
                if let Some((base_ids, versions, resolve_depths)) =
                    edges_to_traverse.get(&edge_kind)
                {
                    entity_type_queue.extend(
                        self.read_ontology_edges(base_ids, versions, table)
                            .await?
                            .map(|(source, target, index)| {
                                let source_vertex_id = EntityTypeVertexId::from(source);
                                let target_vertex_id = EntityTypeVertexId::from(target);

                                traversal_context
                                    .entity_type_ids
                                    .insert(target_vertex_id.clone());

                                subgraph.insert_edge(
                                    &source_vertex_id,
                                    edge_kind,
                                    EdgeDirection::Outgoing,
                                    target_vertex_id.clone(),
                                );

                                (target_vertex_id, resolve_depths[index])
                            }),
                    );
                }
            }
        }

        self.traverse_property_types(property_type_queue, traversal_context, subgraph)
            .await?;

        Ok(())
    }

    #[tracing::instrument(level = "trace", skip(self))]
    #[cfg(hash_graph_test_environment)]
    pub async fn delete_entity_types(&mut self) -> Result<(), DeletionError> {
        let transaction = self.transaction().await.change_context(DeletionError)?;

        transaction
            .as_client()
            .simple_query(
                r"
                    DELETE FROM entity_type_inherits_from;
                    DELETE FROM entity_type_constrains_link_destinations_on;
                    DELETE FROM entity_type_constrains_links_on;
                    DELETE FROM entity_type_constrains_properties_on;
                ",
            )
            .await
            .into_report()
            .change_context(DeletionError)?;

        let entity_types = transaction
            .as_client()
            .query(
                r"
                    DELETE FROM entity_types
                    RETURNING ontology_id
                ",
                &[],
            )
            .await
            .into_report()
            .change_context(DeletionError)?
            .into_iter()
            .filter_map(|row| row.get(0))
            .collect::<Vec<OntologyId>>();

        transaction.delete_ontology_ids(&entity_types).await?;

        transaction.commit().await.change_context(DeletionError)?;

        Ok(())
    }
}

#[async_trait]
impl<C: AsClient> EntityTypeStore for PostgresStore<C> {
    #[tracing::instrument(level = "info", skip(self, entity_types))]
    async fn create_entity_types(
        &mut self,
        entity_types: impl IntoIterator<
            Item = (
                EntityType,
                impl Borrow<OntologyElementMetadata> + Send + Sync,
            ),
            IntoIter: Send,
        > + Send,
        on_conflict: ConflictBehavior,
    ) -> Result<(), InsertionError> {
        let entity_types = entity_types.into_iter();
        let transaction = self.transaction().await.change_context(InsertionError)?;

        let mut inserted_entity_types = Vec::with_capacity(entity_types.size_hint().0);
        for (schema, metadata) in entity_types {
            if let Some(ontology_id) = transaction
                .create(schema.clone(), metadata.borrow(), on_conflict)
                .await?
            {
                inserted_entity_types.push((ontology_id, schema));
            }
        }

        for (ontology_id, schema) in inserted_entity_types {
            transaction
                .insert_entity_type_references(&schema, ontology_id)
                .await
                .change_context(InsertionError)
                .attach_printable_lazy(|| {
                    format!(
                        "could not insert references for entity type: {}",
                        schema.id()
                    )
                })
                .attach_lazy(|| schema.clone())?;
        }

        transaction.commit().await.change_context(InsertionError)?;

        Ok(())
    }

    #[tracing::instrument(level = "info", skip(self))]
    async fn get_entity_type(
        &self,
        query: &StructuralQuery<EntityTypeWithMetadata>,
    ) -> Result<Subgraph, QueryError> {
        let StructuralQuery {
            ref filter,
            graph_resolve_depths,
            temporal_axes: ref unresolved_temporal_axes,
        } = *query;

        let temporal_axes = unresolved_temporal_axes.clone().resolve();
        let time_axis = temporal_axes.variable_time_axis();

        let entity_types =
            Read::<EntityTypeWithMetadata>::read_vec(self, filter, Some(&temporal_axes))
                .await?
                .into_iter()
                .map(|entity| (entity.vertex_id(time_axis), entity))
                .collect();

        let mut subgraph = Subgraph::new(
            graph_resolve_depths,
            unresolved_temporal_axes.clone(),
            temporal_axes.clone(),
        );
        subgraph.vertices.entity_types = entity_types;

        for vertex_id in subgraph.vertices.entity_types.keys() {
            subgraph.roots.insert(vertex_id.clone().into());
        }

        let mut traversal_context = TraversalContext::default();

        // TODO: We currently pass in the subgraph as mutable reference, thus we cannot borrow the
        //       vertices and have to `.collect()` the keys.
        self.traverse_entity_types(
            subgraph
                .vertices
                .entity_types
                .keys()
                .map(|id| (id.clone(), subgraph.depths))
                .collect(),
            &mut traversal_context,
            &mut subgraph,
        )
        .await?;

        traversal_context.load_vertices(self, &mut subgraph).await?;

        Ok(subgraph)
    }

    #[tracing::instrument(level = "info", skip(self, entity_type))]
    async fn update_entity_type(
        &mut self,
        entity_type: EntityType,
        record_created_by_id: RecordCreatedById,
    ) -> Result<OntologyElementMetadata, UpdateError> {
        let transaction = self.transaction().await.change_context(UpdateError)?;

        // This clone is currently necessary because we extract the references as we insert them.
        // We can only insert them after the type has been created, and so we currently extract them
        // after as well. See `insert_entity_type_references` taking `&entity_type`
        let (ontology_id, metadata) = transaction
            .update::<EntityType>(entity_type.clone(), record_created_by_id)
            .await?;

        transaction
            .insert_entity_type_references(&entity_type, ontology_id)
            .await
            .change_context(UpdateError)
            .attach_printable_lazy(|| {
                format!(
                    "could not insert references for entity type: {}",
                    entity_type.id()
                )
            })
            .attach_lazy(|| entity_type.clone())?;

        transaction.commit().await.change_context(UpdateError)?;

        Ok(metadata)
    }
}
