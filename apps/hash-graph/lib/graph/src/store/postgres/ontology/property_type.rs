use std::{borrow::Borrow, mem};

use async_trait::async_trait;
use error_stack::{IntoReport, Result, ResultExt};
use tokio_postgres::GenericClient;
use type_system::{
    url::{BaseUrl, VersionedUrl},
    PropertyType,
};
use uuid::Uuid;

use crate::{
    identifier::ontology::OntologyTypeRecordId,
    ontology::{
        DataTypeQueryPath, DataTypeWithMetadata, OntologyElementMetadata, PropertyTypeQueryPath,
        PropertyTypeWithMetadata,
    },
    provenance::RecordCreatedById,
    store::{
        crud::Read,
        error::DeletionError,
        postgres::{ontology::OntologyId, query::SelectCompiler, TraversalContext},
        query::{Filter, FilterExpression, ParameterList},
        AsClient, ConflictBehavior, InsertionError, PostgresStore, PropertyTypeStore, QueryError,
        Record, UpdateError,
    },
    subgraph::{
        edges::{EdgeDirection, GraphResolveDepths, OntologyEdgeKind},
        identifier::{DataTypeVertexId, PropertyTypeVertexId},
        query::StructuralQuery,
        temporal_axes::QueryTemporalAxes,
        Subgraph,
    },
};

impl<C: AsClient> PostgresStore<C> {
    pub(crate) async fn read_property_types_by_ids(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<PropertyTypeWithMetadata>, QueryError> {
        <Self as Read<PropertyTypeWithMetadata>>::read_vec(
            self,
            &Filter::<PropertyTypeWithMetadata>::In(
                FilterExpression::Path(PropertyTypeQueryPath::OntologyId),
                ParameterList::OntologyIds(ids),
            ),
            None,
        )
        .await
    }

    /// Internal method to read a [`PropertyTypeWithMetadata`] into two [`TraversalContext`]s.
    ///
    /// This is used to recursively resolve a type, so the result can be reused.
    #[tracing::instrument(level = "trace", skip(self, traversal_context, subgraph))]
    pub(crate) async fn traverse_property_types(
        &self,
        mut property_type_queue: Vec<(PropertyTypeVertexId, GraphResolveDepths, QueryTemporalAxes)>,
        traversal_context: &mut TraversalContext,
        subgraph: &mut Subgraph,
    ) -> Result<(), QueryError> {
        let time_axis = subgraph.temporal_axes.resolved.variable_time_axis();

        let mut data_type_queue = Vec::new();
        while !property_type_queue.is_empty() {
            let mut constrains_values_on_queue = Vec::new();
            let mut constrains_values_on_depths = Vec::new();
            let mut constrains_properties_on_queue = Vec::new();
            let mut constrains_properties_on_depths = Vec::new();

            for (property_type_vertex_id, graph_resolve_depths, temporal_versioning) in
                property_type_queue.drain(..)
            {
                if let Some(new_graph_resolve_depths) = graph_resolve_depths
                    .decrement_depth_for_edge(
                        OntologyEdgeKind::ConstrainsValuesOn,
                        EdgeDirection::Outgoing,
                    )
                {
                    constrains_values_on_queue.push(format!(
                        "{}v/{}",
                        property_type_vertex_id.base_id.as_str(),
                        property_type_vertex_id.revision_id.inner()
                    ));
                    constrains_values_on_depths
                        .push((new_graph_resolve_depths, temporal_versioning.clone()));
                }

                if let Some(new_graph_resolve_depths) = graph_resolve_depths
                    .decrement_depth_for_edge(
                        OntologyEdgeKind::ConstrainsPropertiesOn,
                        EdgeDirection::Outgoing,
                    )
                {
                    constrains_properties_on_queue.push(format!(
                        "{}v/{}",
                        property_type_vertex_id.base_id.as_str(),
                        property_type_vertex_id.revision_id.inner()
                    ));
                    constrains_properties_on_depths
                        .push((new_graph_resolve_depths, temporal_versioning));
                }
            }

            let mut compiler = SelectCompiler::<DataTypeWithMetadata>::new(None);

            let property_type_base_id_selection = DataTypeQueryPath::PropertyTypeEdge {
                edge_kind: OntologyEdgeKind::ConstrainsValuesOn,
                path: Box::new(PropertyTypeQueryPath::BaseUrl),
            };
            let property_type_revision_selection = DataTypeQueryPath::PropertyTypeEdge {
                edge_kind: OntologyEdgeKind::ConstrainsValuesOn,
                path: Box::new(PropertyTypeQueryPath::Version),
            };
            let data_type_id_index = compiler.add_selection_path(&DataTypeQueryPath::OntologyId);
            let data_type_base_id_index = compiler.add_selection_path(&DataTypeQueryPath::BaseUrl);
            let data_type_revision_index = compiler.add_selection_path(&DataTypeQueryPath::Version);
            let property_type_base_id_index =
                compiler.add_selection_path(&property_type_base_id_selection);
            let property_type_revision_index =
                compiler.add_selection_path(&property_type_revision_selection);

            let filter = Filter::<DataTypeWithMetadata>::In(
                FilterExpression::Path(DataTypeQueryPath::PropertyTypeEdge {
                    edge_kind: OntologyEdgeKind::ConstrainsValuesOn,
                    path: Box::new(PropertyTypeQueryPath::VersionedUrl),
                }),
                ParameterList::VersionedUrls(&constrains_values_on_queue),
            );
            compiler.add_filter(&filter);

            let (sql, parameters) = compiler.compile();

            for (row, (new_graph_resolve_depths, temporal_axes)) in self
                .client
                .as_client()
                .query(&sql, &parameters)
                .await
                .unwrap()
                .into_iter()
                .zip(constrains_values_on_depths)
            {
                let data_type_id = row.get(data_type_id_index);
                let data_type_vertex_id = DataTypeVertexId {
                    base_id: BaseUrl::new(row.get(data_type_base_id_index)).unwrap(),
                    revision_id: row.get(data_type_revision_index),
                };
                let property_type_vertex_id = PropertyTypeVertexId {
                    base_id: BaseUrl::new(row.get(property_type_base_id_index)).unwrap(),
                    revision_id: row.get(property_type_revision_index),
                };
                traversal_context.data_type_ids.push(data_type_id);
                println!(
                    "data_type_id: {:?}, property_type_id: {:?}",
                    data_type_vertex_id, property_type_vertex_id
                );

                subgraph.insert_edge(
                    &property_type_vertex_id,
                    OntologyEdgeKind::ConstrainsValuesOn,
                    EdgeDirection::Outgoing,
                    data_type_vertex_id.clone(),
                );

                data_type_queue.push((
                    data_type_vertex_id,
                    new_graph_resolve_depths,
                    temporal_axes.clone(),
                ));
            }

            let mut compiler = SelectCompiler::<PropertyTypeWithMetadata>::new(None);

            let source_property_type_base_id_selection = PropertyTypeQueryPath::PropertyTypeEdge {
                edge_kind: OntologyEdgeKind::ConstrainsPropertiesOn,
                path: Box::new(PropertyTypeQueryPath::BaseUrl),
                direction: EdgeDirection::Outgoing,
            };
            let source_property_type_revision_selection = PropertyTypeQueryPath::PropertyTypeEdge {
                edge_kind: OntologyEdgeKind::ConstrainsPropertiesOn,
                path: Box::new(PropertyTypeQueryPath::Version),
                direction: EdgeDirection::Outgoing,
            };
            let target_property_type_id_index =
                compiler.add_selection_path(&PropertyTypeQueryPath::OntologyId);
            let target_property_type_base_id_index =
                compiler.add_selection_path(&PropertyTypeQueryPath::BaseUrl);
            let target_property_type_revision_index =
                compiler.add_selection_path(&PropertyTypeQueryPath::Version);
            let source_property_type_base_id_index =
                compiler.add_selection_path(&source_property_type_base_id_selection);
            let source_property_type_revision_index =
                compiler.add_selection_path(&source_property_type_revision_selection);

            let filter = Filter::<PropertyTypeWithMetadata>::In(
                FilterExpression::Path(PropertyTypeQueryPath::PropertyTypeEdge {
                    edge_kind: OntologyEdgeKind::ConstrainsPropertiesOn,
                    path: Box::new(PropertyTypeQueryPath::VersionedUrl),
                    direction: EdgeDirection::Outgoing,
                }),
                ParameterList::VersionedUrls(&constrains_values_on_queue),
            );
            compiler.add_filter(&filter);

            let (sql, parameters) = compiler.compile();

            for (row, (new_graph_resolve_depths, temporal_axes)) in self
                .client
                .as_client()
                .query(&sql, &parameters)
                .await
                .unwrap()
                .into_iter()
                .zip(constrains_properties_on_depths)
            {
                let target_property_type_id = row.get(target_property_type_id_index);
                let target_property_type_vertex_id = PropertyTypeVertexId {
                    base_id: BaseUrl::new(row.get(target_property_type_base_id_index)).unwrap(),
                    revision_id: row.get(target_property_type_revision_index),
                };
                let source_property_type_vertex_id = PropertyTypeVertexId {
                    base_id: BaseUrl::new(row.get(source_property_type_base_id_index)).unwrap(),
                    revision_id: row.get(source_property_type_revision_index),
                };
                traversal_context
                    .property_type_ids
                    .push(target_property_type_id);

                subgraph.insert_edge(
                    &source_property_type_vertex_id,
                    OntologyEdgeKind::ConstrainsPropertiesOn,
                    EdgeDirection::Outgoing,
                    target_property_type_vertex_id.clone(),
                );

                property_type_queue.push((
                    target_property_type_vertex_id,
                    new_graph_resolve_depths,
                    temporal_axes.clone(),
                ));
            }
        }

        self.traverse_data_types(data_type_queue, traversal_context, subgraph)
            .await?;

        Ok(())
    }

    #[tracing::instrument(level = "trace", skip(self))]
    #[cfg(hash_graph_test_environment)]
    pub async fn delete_property_types(&mut self) -> Result<(), DeletionError> {
        let transaction = self.transaction().await.change_context(DeletionError)?;

        transaction
            .as_client()
            .simple_query(
                r"
                    DELETE FROM property_type_constrains_properties_on;
                    DELETE FROM property_type_constrains_values_on;
                ",
            )
            .await
            .into_report()
            .change_context(DeletionError)?;

        let property_types = transaction
            .as_client()
            .query(
                r"
                    DELETE FROM property_types
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

        transaction.delete_ontology_ids(&property_types).await?;

        transaction.commit().await.change_context(DeletionError)?;

        Ok(())
    }
}

#[async_trait]
impl<C: AsClient> PropertyTypeStore for PostgresStore<C> {
    #[tracing::instrument(level = "info", skip(self, property_types))]
    async fn create_property_types(
        &mut self,
        property_types: impl IntoIterator<
            Item = (
                PropertyType,
                impl Borrow<OntologyElementMetadata> + Send + Sync,
            ),
            IntoIter: Send,
        > + Send,
        on_conflict: ConflictBehavior,
    ) -> Result<(), InsertionError> {
        let property_types = property_types.into_iter();
        let transaction = self.transaction().await.change_context(InsertionError)?;

        let mut inserted_property_types = Vec::with_capacity(property_types.size_hint().0);
        for (schema, metadata) in property_types {
            if let Some(ontology_id) = transaction
                .create(schema.clone(), metadata.borrow(), on_conflict)
                .await?
            {
                inserted_property_types.push((ontology_id, schema));
            }
        }

        for (ontology_id, schema) in inserted_property_types {
            transaction
                .insert_property_type_references(&schema, ontology_id)
                .await
                .change_context(InsertionError)
                .attach_printable_lazy(|| {
                    format!(
                        "could not insert references for property type: {}",
                        schema.id()
                    )
                })
                .attach_lazy(|| schema.clone())?;
        }

        transaction.commit().await.change_context(InsertionError)?;

        Ok(())
    }

    #[tracing::instrument(level = "info", skip(self))]
    async fn get_property_type(
        &self,
        query: &StructuralQuery<PropertyTypeWithMetadata>,
    ) -> Result<Subgraph, QueryError> {
        let StructuralQuery {
            ref filter,
            graph_resolve_depths,
            temporal_axes: ref unresolved_temporal_axes,
        } = *query;

        let temporal_axes = unresolved_temporal_axes.clone().resolve();
        let time_axis = temporal_axes.variable_time_axis();

        let property_types =
            Read::<PropertyTypeWithMetadata>::read_vec(self, filter, Some(&temporal_axes))
                .await?
                .into_iter()
                .map(|entity| (entity.vertex_id(time_axis), entity))
                .collect();

        let mut subgraph = Subgraph::new(
            graph_resolve_depths,
            unresolved_temporal_axes.clone(),
            temporal_axes.clone(),
        );
        subgraph.vertices.property_types = property_types;

        for vertex_id in subgraph.vertices.property_types.keys() {
            subgraph.roots.insert(vertex_id.clone().into());
        }

        let mut traversal_context = TraversalContext::default();

        // TODO: We currently pass in the subgraph as mutable reference, thus we cannot borrow the
        //       vertices and have to `.collect()` the keys.
        self.traverse_property_types(
            subgraph
                .vertices
                .property_types
                .keys()
                .map(|id| {
                    (
                        id.clone(),
                        subgraph.depths,
                        subgraph.temporal_axes.resolved.clone(),
                    )
                })
                .collect(),
            &mut traversal_context,
            &mut subgraph,
        )
        .await?;

        traversal_context.load_vertices(self, &mut subgraph).await?;

        Ok(subgraph)
    }

    #[tracing::instrument(level = "info", skip(self, property_type))]
    async fn update_property_type(
        &mut self,
        property_type: PropertyType,
        record_created_by_id: RecordCreatedById,
    ) -> Result<OntologyElementMetadata, UpdateError> {
        let transaction = self.transaction().await.change_context(UpdateError)?;

        // This clone is currently necessary because we extract the references as we insert them.
        // We can only insert them after the type has been created, and so we currently extract them
        // after as well. See `insert_property_type_references` taking `&property_type`
        let (ontology_id, metadata) = transaction
            .update::<PropertyType>(property_type.clone(), record_created_by_id)
            .await?;

        transaction
            .insert_property_type_references(&property_type, ontology_id)
            .await
            .change_context(UpdateError)
            .attach_printable_lazy(|| {
                format!(
                    "could not insert references for property type: {}",
                    property_type.id()
                )
            })
            .attach_lazy(|| property_type.clone())?;

        transaction.commit().await.change_context(UpdateError)?;

        Ok(metadata)
    }
}
