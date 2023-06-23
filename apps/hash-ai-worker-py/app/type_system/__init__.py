"""Replicates the Block Protocol type system to be used in Python."""

from typing import Any

from pydantic import BaseModel, Field

from ._json_schema import AllOf, OneOf, Object, Array, EmptyDict


class DataTypeReference(BaseModel):
    ref: str = Field(..., alias="$ref")


class PropertyTypeReference(BaseModel):
    ref: str = Field(..., alias="$ref")


class EntityTypeReference(BaseModel):
    ref: str = Field(..., alias="$ref")


class OntologyType(BaseModel):
    """Common base class for all ontology types."""

    identifier: str = Field(..., alias="$id")
    title: str
    description: str | None
    kind: str
    schema_url: str = Field(..., alias="$schema")

    def openai_schema(self) -> dict[str, Any]:
        """Creates a schema to be consumed by the OpenAI function API."""
        return (
            {
                "name": self.title,
                "description": self.description,
                "parameters": self.dict(
                    by_alias=True,
                    exclude_none=True,
                    exclude={"title", "description"},
                ),
            },
        )


class DataType(OntologyType):
    ty: str = Field(..., alias="type")


PropertyValue = (
    DataTypeReference
    | Object[PropertyTypeReference | Array[PropertyTypeReference]]
    | Array[OneOf["PropertyValue"]]
)


class PropertyType(OntologyType, OneOf[PropertyValue]):
    pass


class CollapsedPropertyType(OntologyType):
    one_of: list["CollapsedPropertyValue"] = Field(..., alias="oneOf")


CollapsedPropertyValue = (
    DataType
    | Object[CollapsedPropertyType | Array[CollapsedPropertyType]]
    | Array[OneOf["CollapsedPropertyValue"]]
)

CollapsedPropertyType.update_forward_refs()


class EntityType(OntologyType):
    all_of: list[EntityTypeReference] | None = Field(default=None, alias="allOf")
    ty: str = Field(default="object", const=True, alias="type")
    properties: dict[str, PropertyTypeReference | Array[PropertyTypeReference]]
    required: list[str] | None
    examples: list[dict[str, Any]] | None
    links: dict[str, Array[OneOf[EntityTypeReference] | EmptyDict]] | None


class CollapsedEntityType(EntityType):
    all_of: list["CollapsedEntityType"] | None = Field(
        default=None,
        alias="allOf",
    )
    properties: dict[
        str,
        CollapsedPropertyType | Array[CollapsedPropertyType],
    ]
