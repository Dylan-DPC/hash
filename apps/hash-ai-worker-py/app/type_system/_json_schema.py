from typing import Generic, List, TypeVar  # noqa: UP035

from pydantic import BaseModel, Field
from pydantic.generics import GenericModel

T = TypeVar("T")


class OneOf(GenericModel, Generic[T]):
    one_of: List[T] = Field(..., alias="oneOf")  # noqa: UP006


class AllOf(GenericModel, Generic[T]):
    all_of: List[T] = Field(..., alias="allOf")  # noqa: UP006


class Array(GenericModel, Generic[T]):
    ty: str = Field(default="array", const=True, alias="type")
    items: T
    min_items: int | None = Field(default=None, alias="minItems")
    max_items: int | None = Field(default=None, alias="maxItems")


class Object(GenericModel, Generic[T]):
    ty: str = Field(default="object", const=True, alias="type")
    properties: dict[str, T]
    required: list[str] | None


class EmptyDict(BaseModel):
    class Config:
        title = None
        extra = "forbid"
