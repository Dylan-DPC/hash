CREATE TABLE IF NOT EXISTS
  "type_ids" (
    "version_id" UUID PRIMARY KEY,
    "base_uri" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "owned_by_id" UUID NOT NULL REFERENCES "accounts",
    "updated_by_id" UUID NOT NULL REFERENCES "accounts",
    "transaction_time" tstzrange NOT NULL,
    UNIQUE ("base_uri", "version"),
    CONSTRAINT type_ids_overlapping EXCLUDE USING gist (
      base_uri
      WITH
        =,
        transaction_time
      WITH
        &&
    ) DEFERRABLE INITIALLY IMMEDIATE
  );

COMMENT
  ON TABLE "type_ids" IS $pga$
    This table is a boundary to define the actual identification scheme for our kinds of types. 
    Assume that we use the UUIDs on the types to look up more specific ID details. 
  $pga$;

CREATE TABLE IF NOT EXISTS
  "data_types" (
    "version_id" UUID PRIMARY KEY REFERENCES "type_ids",
    "schema" JSONB NOT NULL
  );

CREATE TABLE IF NOT EXISTS
  "property_types" (
    "version_id" UUID PRIMARY KEY REFERENCES "type_ids",
    "schema" JSONB NOT NULL
  );

CREATE TABLE IF NOT EXISTS
  "owned_entity_types" (
    "version_id" UUID PRIMARY KEY REFERENCES "type_ids",
    "schema" JSONB NOT NULL
  );

CREATE TABLE IF NOT EXISTS
  "closed_entity_types" (
    "closed_type_id" UUID PRIMARY KEY NOT NULL,
    "closed_schema" JSONB NOT NULL,
    "is_link_type" BOOLEAN NOT NULL
  );

COMMENT
  ON TABLE "closed_entity_types" IS $pga$
    This table represents all entity types in the system. Their schemas are inlined and available 
    to be used from this table. 
$pga$;

CREATE TABLE IF NOT EXISTS
  "closed_entity_types_to_constituent_types" (
    "closed_type_id" UUID NOT NULL REFERENCES "closed_entity_types",
    -- An ancestor of the type in the closure 
    -- (e.g. a grandparent of the type under an inheritance chain)
    -- We're referencing "type_ids" here because we don't want to box ourselves into only having
    -- owned types here.
    -- We want to be able to have constitutent types that are cached external types, or owned types.
    "constituent_type_id" UUID NOT NULL REFERENCES "type_ids",
    -- For a normal (owned or cached external) entity type this will be true if this is the closure 
    -- of that entity type. 
    -- If this is a closure of an "anonymous" type, this will be true for all entity types that make
    -- up the anonymous type.
    -- This is therefore a *superset* of the inverse of the set of 
    -- "owned_entity_types_to_closed_entity_types" and future respective table for 
    -- cached external entity types
    "direct" BOOLEAN NOT NULL,
    -- Entity type closures cannot consist of multiples of the same type_id.
    PRIMARY KEY ("closed_type_id", "constituent_type_id")
  );

COMMENT
  ON TABLE "closed_entity_types_to_constituent_types" IS $pga$ 
    This table represents a transitive closure of an inheritance chain for a given entity type. 
    This is also able to represent "anonymous" entity types which are combinations of (compatible) 
    entity types. 
$pga$;

CREATE TABLE IF NOT EXISTS
  "owned_entity_types_to_closed_entity_types" (
    "constituent_type_id" UUID NOT NULL REFERENCES "owned_entity_types",
    "closed_type_id" UUID NOT NULL REFERENCES "closed_entity_types"
  );

COMMENT
  ON TABLE "owned_entity_types_to_closed_entity_types" IS $pga$ 
    This table represents the mapping from owned (i.e. non external) entity types  to their closure. 
    This allows for an entity type to find its ancestor entity types. 
$pga$;

CREATE TABLE IF NOT EXISTS
  "property_type_property_type_references" (
    "source_property_type_version_id" UUID NOT NULL REFERENCES "property_types",
    "target_property_type_version_id" UUID NOT NULL REFERENCES "property_types"
  );

CREATE TABLE IF NOT EXISTS
  "property_type_data_type_references" (
    "source_property_type_version_id" UUID NOT NULL REFERENCES "property_types",
    "target_data_type_version_id" UUID NOT NULL REFERENCES "data_types"
  );

CREATE TABLE IF NOT EXISTS
  "entity_type_property_type_references" (
    "source_entity_type_version_id" UUID NOT NULL REFERENCES "closed_entity_types",
    "target_property_type_version_id" UUID NOT NULL REFERENCES "property_types"
  );

CREATE TABLE IF NOT EXISTS
  "entity_type_entity_type_references" (
    "source_entity_type_version_id" UUID NOT NULL REFERENCES "closed_entity_types",
    "target_entity_type_version_id" UUID NOT NULL REFERENCES "closed_entity_types"
  );
