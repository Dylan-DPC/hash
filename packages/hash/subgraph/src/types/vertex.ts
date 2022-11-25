import { BaseUri } from "@blockprotocol/type-system-web";
import {
  DataTypeWithMetadata,
  EntityWithMetadata,
  EntityTypeWithMetadata,
  PropertyTypeWithMetadata,
} from "./element";
import { EntityId, EntityVersion } from "./identifier";

// -------------------------------- Vertex Variants --------------------------------

export type DataTypeVertex = { kind: "dataType"; inner: DataTypeWithMetadata };

export type PropertyTypeVertex = {
  kind: "propertyType";
  inner: PropertyTypeWithMetadata;
};

export type EntityTypeVertex = {
  kind: "entityType";
  inner: EntityTypeWithMetadata;
};

export type EntityVertex = { kind: "entity"; inner: EntityWithMetadata };

export type OntologyVertex =
  | DataTypeVertex
  | PropertyTypeVertex
  | EntityTypeVertex;

export type KnowledgeGraphVertex = EntityVertex;

export type Vertex = OntologyVertex | KnowledgeGraphVertex;

export const isDataTypeVertex = (vertex: Vertex): vertex is DataTypeVertex => {
  return vertex.kind === "dataType";
};

export const isPropertyTypeVertex = (
  vertex: Vertex,
): vertex is PropertyTypeVertex => {
  return vertex.kind === "propertyType";
};

export const isEntityTypeVertex = (
  vertex: Vertex,
): vertex is EntityTypeVertex => {
  return vertex.kind === "entityType";
};

export const isEntityVertex = (vertex: Vertex): vertex is EntityVertex => {
  return vertex.kind === "entity";
};

// -------------------------------- The `Vertices` type --------------------------------

export type Vertices = {
  [_: BaseUri]: {
    [_: number]: OntologyVertex;
  };
} & {
  [_: EntityId]: {
    [_: EntityVersion]: KnowledgeGraphVertex;
  };
};