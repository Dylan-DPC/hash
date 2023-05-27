mod read;

use std::{collections::HashMap, mem::swap};

use async_trait::async_trait;
use error_stack::{IntoReport, Report, Result, ResultExt};
use tokio_postgres::{error::SqlState, GenericClient};
use type_system::url::{BaseUrl, VersionedUrl};
use uuid::Uuid;

use crate::{
    identifier::{
        knowledge::{EntityEditionId, EntityId, EntityRecordId, EntityTemporalMetadata},
        ontology::OntologyTypeVersion,
        time::{DecisionTime, RightBoundedTemporalInterval, TemporalTagged, TimeAxis, Timestamp},
    },
    knowledge::{
        Entity, EntityLinkOrder, EntityMetadata, EntityProperties, EntityQueryPath, EntityUuid,
        LinkData,
    },
    provenance::{OwnedById, ProvenanceMetadata, RecordCreatedById},
    store::{
        crud::Read,
        error::{DeletionError, EntityDoesNotExist, RaceConditionOnUpdate},
        postgres::{
            query::{ForeignKeyReference, ReferenceTable, Table, Transpile},
            TraversalContext,
        },
        query::{Filter, FilterExpression, ParameterList},
        AsClient, EntityStore, InsertionError, PostgresStore, QueryError, Record, UpdateError,
    },
    subgraph::{
        edges::{EdgeDirection, GraphResolveDepths, KnowledgeGraphEdgeKind, SharedEdgeKind},
        identifier::{EntityIdWithInterval, EntityTypeVertexId, EntityVertexId},
        query::StructuralQuery,
        temporal_axes::{PinnedAxis, QueryTemporalAxes, VariableAxis},
        Subgraph,
    },
};

impl<C: AsClient> PostgresStore<C> {
    pub(crate) async fn read_entities_by_ids(
        &self,
        vertex_ids: impl IntoIterator<Item = EntityEditionId> + Send,
        temporal_axes: &QueryTemporalAxes,
    ) -> Result<Vec<Entity>, QueryError> {
        let ids = vertex_ids
            .into_iter()
            .map(|id| id.as_uuid())
            .collect::<Vec<_>>();

        <Self as Read<Entity>>::read_vec(
            self,
            &Filter::<Entity>::In(
                FilterExpression::Path(EntityQueryPath::EditionId),
                ParameterList::Uuid(&ids),
            ),
            Some(temporal_axes),
        )
        .await
    }

    pub(crate) async fn read_shared_edges(
        &self,
        owned_by_ids: &[OwnedById],
        entity_uuids: &[EntityUuid],
        intervals: &[RightBoundedTemporalInterval<VariableAxis>],
        pinned: Timestamp<PinnedAxis>,
        variable_axis: TimeAxis,
    ) -> Result<impl Iterator<Item = (EntityVertexId, VersionedUrl, usize)>, QueryError> {
        let (pinned_axis_column, variable_axis_column) = match variable_axis {
            TimeAxis::DecisionTime => ("transaction_time", "decision_time"),
            TimeAxis::TransactionTime => ("decision_time", "transaction_time"),
        };

        Ok(self
            .client
            .as_client()
            .query(
                &format!(
                    r#"
                        SELECT
                            entity_temporal_metadata.owned_by_id,
                            entity_temporal_metadata.entity_uuid,
                            lower(entity_temporal_metadata.{variable_axis_column}),
                            ontology_ids.base_url,
                            ontology_ids.version,
                            filter.idx
                        FROM entity_is_of_type

                        JOIN entity_temporal_metadata
                          ON entity_temporal_metadata.entity_edition_id
                             = entity_is_of_type.entity_edition_id
                         AND entity_temporal_metadata.{pinned_axis_column} @> $4::timestamptz

                        JOIN unnest($1::uuid[], $2::uuid[], $3::tstzrange[])
                             WITH ORDINALITY AS filter(owned_by_id, entity_uuid, interval, idx)
                          ON filter.owned_by_id = entity_temporal_metadata.owned_by_id
                         AND filter.entity_uuid = entity_temporal_metadata.entity_uuid
                         AND filter.interval && entity_temporal_metadata.{variable_axis_column}

                        JOIN ontology_ids
                          ON entity_is_of_type.entity_type_ontology_id = ontology_ids.ontology_id;
                    "#
                ),
                &[&owned_by_ids, &entity_uuids, &intervals, &pinned],
            )
            .await
            .into_report()
            .change_context(QueryError)?
            .into_iter()
            .map(|row| {
                let source_vertex_id = EntityVertexId {
                    base_id: EntityId {
                        owned_by_id: row.get(0),
                        entity_uuid: row.get(1),
                    },
                    revision_id: row.get::<_, Timestamp<()>>(2).cast(),
                };
                let target_vertex_id = VersionedUrl {
                    base_url: BaseUrl::new(row.get(3)).expect("invalid URL"),
                    version: row.get::<_, OntologyTypeVersion>(4).inner(),
                };
                let index = usize::try_from(row.get::<_, i64>(5) - 1).expect("invalid index");
                (source_vertex_id, target_vertex_id, index)
            }))
    }

    pub(crate) async fn read_entity_edges(
        &self,
        owned_by_ids: &[OwnedById],
        entity_uuids: &[EntityUuid],
        intervals: &[RightBoundedTemporalInterval<VariableAxis>],
        pinned: Timestamp<PinnedAxis>,
        variable_axis: TimeAxis,
        reference_table: ReferenceTable,
        edge_direction: EdgeDirection,
    ) -> Result<
        impl Iterator<
            Item = (
                EntityVertexId,
                EntityVertexId,
                EntityIdWithInterval,
                EntityEditionId,
                RightBoundedTemporalInterval<VariableAxis>,
                usize,
            ),
        >,
        QueryError,
    > {
        let (pinned_axis_column, variable_axis_column) = match variable_axis {
            TimeAxis::DecisionTime => ("transaction_time", "decision_time"),
            TimeAxis::TransactionTime => ("decision_time", "transaction_time"),
        };

        let table = Table::Reference(reference_table).transpile_to_string();
        let [mut source_1, mut source_2] =
            if let ForeignKeyReference::Double { join, .. } = reference_table.source_relation() {
                [join[0].transpile_to_string(), join[1].transpile_to_string()]
            } else {
                unreachable!("entity reference tables don't have single conditions")
            };
        let [mut target_1, mut target_2] =
            if let ForeignKeyReference::Double { on, .. } = reference_table.target_relation() {
                [on[0].transpile_to_string(), on[1].transpile_to_string()]
            } else {
                unreachable!("entity reference tables don't have single conditions")
            };

        if edge_direction == EdgeDirection::Incoming {
            swap(&mut source_1, &mut target_1);
            swap(&mut source_2, &mut target_2);
        }

        Ok(self
            .client
            .as_client()
            .query(
                &format!(
                    r#"
                        SELECT
                            source.owned_by_id,
                            source.entity_uuid,
                            lower(source.{variable_axis_column}),
                            target.owned_by_id,
                            target.entity_uuid,
                            lower(source.{variable_axis_column}),
                            source.{variable_axis_column} * target.{variable_axis_column},
                            target.entity_edition_id,
                            source.{variable_axis_column} * target.{variable_axis_column} * filter.interval,
                            filter.idx
                        FROM {table}

                        JOIN entity_temporal_metadata AS source
                          ON source.owned_by_id = {source_1}
                         AND source.entity_uuid = {source_2}
                         AND source.{pinned_axis_column} @> $4::timestamptz

                        JOIN entity_temporal_metadata AS target
                          ON target.owned_by_id = {target_1}
                         AND target.entity_uuid = {target_2}
                         AND target.{pinned_axis_column} @> $4::timestamptz
                         AND target.{variable_axis_column} && source.{variable_axis_column}

                        JOIN unnest($1::uuid[], $2::uuid[], $3::tstzrange[])
                             WITH ORDINALITY AS filter(owned_by_id, entity_uuid, interval, idx)
                          ON filter.owned_by_id = source.owned_by_id
                         AND filter.entity_uuid = source.entity_uuid
                         AND filter.interval && source.{variable_axis_column}
                         AND filter.interval && target.{variable_axis_column}
                    "#
                ),
                &[&owned_by_ids, &entity_uuids, &intervals, &pinned],
            )
            .await
            .into_report()
            .change_context(QueryError)?
            .into_iter()
            .map(|row| {
                let source_vertex_id = EntityVertexId {
                    base_id: EntityId {
                        owned_by_id: row.get(0),
                        entity_uuid: row.get(1),
                    },
                    revision_id: row.get::<_, Timestamp<()>>(2).cast(),
                };
                let target_vertex_id = EntityVertexId {
                    base_id: EntityId {
                        owned_by_id: row.get(3),
                        entity_uuid: row.get(4),
                    },
                    revision_id: row.get::<_, Timestamp<()>>(5).cast(),
                };
                let target_id = EntityIdWithInterval {
                    entity_id: target_vertex_id.base_id,
                    interval: row.get(6),
                };
                let target_entity_edition_id = row.get(7);
                let interval = row.get(8);
                let index = usize::try_from(row.get::<_, i64>(9) - 1).expect("invalid index");
                (source_vertex_id, target_vertex_id, target_id, target_entity_edition_id, interval, index)
            }))
    }

    /// Internal method to read an [`Entity`] into a [`TraversalContext`].
    ///
    /// This is used to recursively resolve a type, so the result can be reused.
    #[tracing::instrument(level = "trace", skip(self, traversal_context, subgraph))]
    pub(crate) async fn traverse_entities(
        &self,
        mut entity_queue: Vec<(EntityVertexId, GraphResolveDepths, QueryTemporalAxes)>,
        traversal_context: &mut TraversalContext,
        subgraph: &mut Subgraph,
    ) -> Result<(), QueryError> {
        let mut entity_type_queue = Vec::new();
        let pinned_timestamp = subgraph.temporal_axes.resolved.pinned_timestamp();
        let variable_time_axis = subgraph.temporal_axes.resolved.variable_time_axis();

        while !entity_queue.is_empty() {
            let mut ontology_edges_to_traverse = Option::<(Vec<_>, Vec<_>, Vec<_>, Vec<_>)>::None;
            let mut entity_edges_to_traverse = HashMap::<
                (KnowledgeGraphEdgeKind, EdgeDirection),
                (Vec<_>, Vec<_>, Vec<_>, Vec<_>),
            >::new();

            let entity_edges = [
                (
                    KnowledgeGraphEdgeKind::HasLeftEntity,
                    EdgeDirection::Incoming,
                    ReferenceTable::EntityHasLeftEntity,
                ),
                (
                    KnowledgeGraphEdgeKind::HasRightEntity,
                    EdgeDirection::Incoming,
                    ReferenceTable::EntityHasRightEntity,
                ),
                (
                    KnowledgeGraphEdgeKind::HasLeftEntity,
                    EdgeDirection::Outgoing,
                    ReferenceTable::EntityHasLeftEntity,
                ),
                (
                    KnowledgeGraphEdgeKind::HasRightEntity,
                    EdgeDirection::Outgoing,
                    ReferenceTable::EntityHasRightEntity,
                ),
            ];

            #[expect(clippy::iter_with_drain, reason = "false positive, vector is reused")]
            for (entity_vertex_id, graph_resolve_depths, temporal_axes) in entity_queue.drain(..) {
                if let Some(new_graph_resolve_depths) = graph_resolve_depths
                    .decrement_depth_for_edge(SharedEdgeKind::IsOfType, EdgeDirection::Outgoing)
                {
                    let entry = ontology_edges_to_traverse.get_or_insert_with(Default::default);
                    entry.0.push(entity_vertex_id.base_id.owned_by_id);
                    entry.1.push(entity_vertex_id.base_id.entity_uuid);
                    entry.2.push(temporal_axes.variable_interval());
                    entry.3.push(new_graph_resolve_depths);
                }

                for (edge_kind, edge_direction, _) in entity_edges {
                    if let Some(new_graph_resolve_depths) =
                        graph_resolve_depths.decrement_depth_for_edge(edge_kind, edge_direction)
                    {
                        let entry = entity_edges_to_traverse
                            .entry((edge_kind, edge_direction))
                            .or_default();
                        entry.0.push(entity_vertex_id.base_id.owned_by_id);
                        entry.1.push(entity_vertex_id.base_id.entity_uuid);
                        entry.2.push(temporal_axes.variable_interval());
                        entry.3.push(new_graph_resolve_depths);
                    }
                }
            }

            if let Some((owned_by_ids, entity_uuids, intervals, resolve_depths)) =
                ontology_edges_to_traverse.take()
            {
                entity_type_queue.extend(
                    self.read_shared_edges(
                        &owned_by_ids,
                        &entity_uuids,
                        &intervals,
                        pinned_timestamp,
                        variable_time_axis,
                    )
                    .await?
                    .map(|(source_vertex_id, target_url, index)| {
                        let target_vertex_id = EntityTypeVertexId::from(target_url);

                        traversal_context
                            .entity_type_ids
                            .insert(target_vertex_id.clone());

                        subgraph.insert_edge(
                            &source_vertex_id,
                            SharedEdgeKind::IsOfType,
                            EdgeDirection::Outgoing,
                            target_vertex_id.clone(),
                        );

                        (target_vertex_id, resolve_depths[index])
                    }),
                );
            }

            for (edge_kind, edge_direction, table) in entity_edges {
                if let Some((owned_by_ids, entity_uuids, intervals, resolve_depths)) =
                    entity_edges_to_traverse.get(&(edge_kind, edge_direction))
                {
                    entity_queue.extend(
                        self.read_entity_edges(
                            owned_by_ids,
                            entity_uuids,
                            intervals,
                            pinned_timestamp,
                            variable_time_axis,
                            table,
                            edge_direction,
                        )
                        .await?
                        .map(
                            |(
                                source_vertex_id,
                                target_vertex_id,
                                target_id,
                                target_edition_id,
                                new_interval,
                                index,
                            )| {
                                traversal_context
                                    .entity_edition_ids
                                    .insert(target_edition_id);

                                subgraph.insert_edge(
                                    &source_vertex_id,
                                    edge_kind,
                                    edge_direction,
                                    target_id,
                                );

                                (
                                    target_vertex_id,
                                    resolve_depths[index],
                                    QueryTemporalAxes::from_variable_time_axis(
                                        variable_time_axis,
                                        pinned_timestamp,
                                        new_interval,
                                    ),
                                )
                            },
                        ),
                    );
                }
            }
        }

        self.traverse_entity_types(entity_type_queue, traversal_context, subgraph)
            .await?;

        Ok(())
    }

    #[tracing::instrument(level = "trace", skip(self))]
    #[cfg(hash_graph_test_environment)]
    pub async fn delete_entities(&mut self) -> Result<(), DeletionError> {
        self.as_client()
            .client()
            .simple_query(
                r"
                    DELETE FROM entity_has_left_entity;
                    DELETE FROM entity_has_right_entity;
                    DELETE FROM entity_is_of_type;
                    DELETE FROM entity_temporal_metadata;
                    DELETE FROM entity_editions;
                    DELETE FROM entity_ids;
                ",
            )
            .await
            .into_report()
            .change_context(DeletionError)?;

        Ok(())
    }
}

#[async_trait]
impl<C: AsClient> EntityStore for PostgresStore<C> {
    #[tracing::instrument(level = "info", skip(self, properties))]
    async fn create_entity(
        &mut self,
        owned_by_id: OwnedById,
        entity_uuid: Option<EntityUuid>,
        decision_time: Option<Timestamp<DecisionTime>>,
        record_created_by_id: RecordCreatedById,
        archived: bool,
        entity_type_id: VersionedUrl,
        properties: EntityProperties,
        link_data: Option<LinkData>,
    ) -> Result<EntityMetadata, InsertionError> {
        let entity_id = EntityId {
            owned_by_id,
            entity_uuid: entity_uuid.unwrap_or_else(|| EntityUuid::new(Uuid::new_v4())),
        };

        let entity_type_ontology_id = self
            .ontology_id_by_url(&entity_type_id)
            .await
            .change_context(InsertionError)?;

        let row = self
            .as_client()
            .query_one(
                r#"
                SELECT
                    entity_edition_id,
                    decision_time,
                    transaction_time
                FROM
                    create_entity(
                        _owned_by_id := $1,
                        _entity_uuid := $2,
                        _decision_time := $3,
                        _record_created_by_id := $4,
                        _archived := $5,
                        _entity_type_ontology_id := $6,
                        _properties := $7,
                        _left_owned_by_id := $8,
                        _left_entity_uuid := $9,
                        _right_owned_by_id := $10,
                        _right_entity_uuid := $11,
                        _left_to_right_order := $12,
                        _right_to_left_order := $13
                    );
                "#,
                &[
                    &entity_id.owned_by_id,
                    &entity_id.entity_uuid,
                    &decision_time,
                    &record_created_by_id,
                    &archived,
                    &entity_type_ontology_id,
                    &properties,
                    &link_data
                        .as_ref()
                        .map(|metadata| metadata.left_entity_id.owned_by_id),
                    &link_data
                        .as_ref()
                        .map(|metadata| metadata.left_entity_id.entity_uuid),
                    &link_data
                        .as_ref()
                        .map(|metadata| metadata.right_entity_id.owned_by_id),
                    &link_data
                        .as_ref()
                        .map(|metadata| metadata.right_entity_id.entity_uuid),
                    &link_data
                        .as_ref()
                        .map(|link_data| link_data.order.left_to_right),
                    &link_data
                        .as_ref()
                        .map(|link_data| link_data.order.right_to_left),
                ],
            )
            .await
            .into_report()
            .change_context(InsertionError)?;

        Ok(EntityMetadata::new(
            EntityRecordId {
                entity_id,
                edition_id: EntityEditionId::new(row.get(0)),
            },
            EntityTemporalMetadata {
                decision_time: row.get(1),
                transaction_time: row.get(2),
            },
            entity_type_id,
            ProvenanceMetadata::new(record_created_by_id),
            archived,
        ))
    }

    #[doc(hidden)]
    #[cfg(hash_graph_test_environment)]
    async fn insert_entities_batched_by_type(
        &mut self,
        entities: impl IntoIterator<
            Item = (
                OwnedById,
                Option<EntityUuid>,
                EntityProperties,
                Option<LinkData>,
                Option<Timestamp<DecisionTime>>,
            ),
            IntoIter: Send,
        > + Send,
        actor_id: RecordCreatedById,
        entity_type_id: &VersionedUrl,
    ) -> Result<Vec<EntityMetadata>, InsertionError> {
        let transaction = self.transaction().await.change_context(InsertionError)?;

        let entities = entities.into_iter();
        let mut entity_ids = Vec::with_capacity(entities.size_hint().0);
        let mut entity_editions = Vec::with_capacity(entities.size_hint().0);
        let mut entity_versions = Vec::with_capacity(entities.size_hint().0);
        for (owned_by_id, entity_uuid, properties, link_data, decision_time) in entities {
            entity_ids.push((
                EntityId {
                    owned_by_id,
                    entity_uuid: entity_uuid.unwrap_or_else(|| EntityUuid::new(Uuid::new_v4())),
                },
                link_data.as_ref().map(|link_data| link_data.left_entity_id),
                link_data
                    .as_ref()
                    .map(|link_data| link_data.right_entity_id),
            ));
            entity_editions.push((
                properties,
                link_data
                    .as_ref()
                    .and_then(|link_data| link_data.order.left_to_right),
                link_data
                    .as_ref()
                    .and_then(|link_data| link_data.order.right_to_left),
            ));
            entity_versions.push(decision_time);
        }

        // TODO: match on and return the relevant error
        //   https://app.asana.com/0/1200211978612931/1202574350052904/f
        transaction
            .insert_entity_ids(entity_ids.iter().copied().map(|(id, ..)| id))
            .await?;

        transaction
            .insert_entity_links(
                "left",
                entity_ids
                    .iter()
                    .copied()
                    .filter_map(|(id, left, _)| left.map(|left| (id, left))),
            )
            .await?;
        transaction
            .insert_entity_links(
                "right",
                entity_ids
                    .iter()
                    .copied()
                    .filter_map(|(id, _, right)| right.map(|right| (id, right))),
            )
            .await?;

        // Using one entity type per entity would result in more lookups, which results in a more
        // complex logic and/or be inefficient.
        // Please see the documentation for this function on the trait for more information.
        let entity_type_ontology_id = transaction
            .ontology_id_by_url(entity_type_id)
            .await
            .change_context(InsertionError)?;

        let entity_edition_ids = transaction
            .insert_entity_records(entity_editions, actor_id)
            .await?;

        let entity_versions = transaction
            .insert_entity_versions(
                entity_ids
                    .iter()
                    .copied()
                    .zip(entity_edition_ids.iter().copied())
                    .zip(entity_versions)
                    .map(|(((entity_id, ..), entity_edition_id), decision_time)| {
                        (entity_id, entity_edition_id, decision_time)
                    }),
            )
            .await?;

        transaction
            .insert_entity_is_of_type(entity_edition_ids.iter().copied(), entity_type_ontology_id)
            .await?;

        transaction.commit().await.change_context(InsertionError)?;

        Ok(entity_ids
            .into_iter()
            .zip(entity_versions)
            .zip(entity_edition_ids)
            .map(|(((entity_id, ..), entity_version), edition_id)| {
                EntityMetadata::new(
                    EntityRecordId {
                        entity_id,
                        edition_id,
                    },
                    entity_version,
                    entity_type_id.clone(),
                    ProvenanceMetadata::new(actor_id),
                    false,
                )
            })
            .collect())
    }

    #[tracing::instrument(level = "info", skip(self))]
    async fn get_entity(&self, query: &StructuralQuery<Entity>) -> Result<Subgraph, QueryError> {
        let StructuralQuery {
            ref filter,
            graph_resolve_depths,
            temporal_axes: ref unresolved_temporal_axes,
        } = *query;

        let temporal_axes = unresolved_temporal_axes.clone().resolve();
        let time_axis = temporal_axes.variable_time_axis();

        let entities = Read::<Entity>::read_vec(self, filter, Some(&temporal_axes))
            .await?
            .into_iter()
            .map(|entity| (entity.vertex_id(time_axis), entity))
            .collect();

        let mut subgraph = Subgraph::new(
            graph_resolve_depths,
            unresolved_temporal_axes.clone(),
            temporal_axes.clone(),
        );
        subgraph.vertices.entities = entities;

        for vertex_id in subgraph.vertices.entities.keys() {
            subgraph.roots.insert((*vertex_id).into());
        }

        let mut traversal_context = TraversalContext::default();

        // TODO: We currently pass in the subgraph as mutable reference, thus we cannot borrow the
        //       vertices and have to `.collect()` the keys.
        self.traverse_entities(
            subgraph
                .vertices
                .entities
                .keys()
                .map(|id| {
                    (
                        *id,
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

    #[tracing::instrument(level = "info", skip(self, properties))]
    async fn update_entity(
        &mut self,
        entity_id: EntityId,
        decision_time: Option<Timestamp<DecisionTime>>,
        record_created_by_id: RecordCreatedById,
        archived: bool,
        entity_type_id: VersionedUrl,
        properties: EntityProperties,
        link_order: EntityLinkOrder,
    ) -> Result<EntityMetadata, UpdateError> {
        let entity_type_ontology_id = self
            .ontology_id_by_url(&entity_type_id)
            .await
            .change_context(UpdateError)?;

        // The transaction is required to check if the update happened. If there is no returned
        // row, it either means, that there was no entity with that parameters or a race condition
        // happened.
        let transaction = self.transaction().await.change_context(UpdateError)?;

        if transaction
            .as_client()
            .query_opt(
                r#"
                 SELECT EXISTS (
                    SELECT 1 FROM entity_ids WHERE owned_by_id = $1 AND entity_uuid = $2
                 );"#,
                &[&entity_id.owned_by_id, &entity_id.entity_uuid],
            )
            .await
            .into_report()
            .change_context(UpdateError)?
            .is_none()
        {
            return Err(Report::new(EntityDoesNotExist)
                .attach(entity_id)
                .change_context(UpdateError));
        }

        let row = transaction
            .as_client()
            .query_one(
                r#"
                SELECT
                    entity_edition_id,
                    decision_time,
                    transaction_time
                FROM
                    update_entity(
                        _owned_by_id := $1,
                        _entity_uuid := $2,
                        _decision_time := $3,
                        _record_created_by_id := $4,
                        _archived := $5,
                        _entity_type_ontology_id := $6,
                        _properties := $7,
                        _left_to_right_order := $8,
                        _right_to_left_order := $9
                    );
                "#,
                &[
                    &entity_id.owned_by_id,
                    &entity_id.entity_uuid,
                    &decision_time,
                    &record_created_by_id,
                    &archived,
                    &entity_type_ontology_id,
                    &properties,
                    &link_order.left_to_right,
                    &link_order.right_to_left,
                ],
            )
            .await
            .into_report()
            .map_err(|report| match report.current_context().code() {
                Some(&SqlState::RESTRICT_VIOLATION) => report
                    .change_context(RaceConditionOnUpdate)
                    .attach(entity_id)
                    .change_context(UpdateError),
                _ => report.change_context(UpdateError).attach(entity_id),
            })?;

        transaction.commit().await.change_context(UpdateError)?;

        Ok(EntityMetadata::new(
            EntityRecordId {
                entity_id,
                edition_id: EntityEditionId::new(row.get(0)),
            },
            EntityTemporalMetadata {
                decision_time: row.get(1),
                transaction_time: row.get(2),
            },
            entity_type_id,
            ProvenanceMetadata::new(record_created_by_id),
            archived,
        ))
    }
}
