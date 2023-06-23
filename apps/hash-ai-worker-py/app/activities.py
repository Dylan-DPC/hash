"""Temporal activities available to workflows."""
import json
from typing import Any

from pydantic import ValidationError
from temporalio import activity

from .type_system import CollapsedEntityType


@activity.defn
async def math(prompt: str) -> Any:
    type = {
        "$schema": (
            "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type"
        ),
        "$id": "https://blockprotocol.org/@examples/types/entity-type/person/v/1",
        "kind": "entityType",
        "title": "Person",
        "description": (
            "An extremely simplified representation of a person or human being."
        ),
        "type": "object",
        "properties": {
            "https://blockprotocol.org/@blockprotocol/types/property-type/name/": {
                "$schema": "https://blockprotocol.org/types/modules/graph/0.3/schema/property-type",
                "$id": "https://blockprotocol.org/@blockprotocol/types/property-type/name/v/1",
                "kind": "propertyType",
                "title": "Name",
                "description": (
                    "A word or set of words by which something is known, addressed, or"
                    " referred to."
                ),
                "oneOf": [
                    {
                        "$schema": "https://blockprotocol.org/types/modules/graph/0.3/schema/data-type",
                        "$id": "https://blockprotocol.org/@blockprotocol/types/data-type/text/v/1",
                        "kind": "dataType",
                        "title": "Text",
                        "description": "An ordered sequence of characters",
                        "type": "string",
                    },
                ],
            },
            "https://blockprotocol.org/@examples/types/property-type/e-mail/": {
                "$schema": "https://blockprotocol.org/types/modules/graph/0.3/schema/property-type",
                "$id": "https://blockprotocol.org/@blockprotocol/types/property-type/e-mail/v/1",
                "kind": "propertyType",
                "title": "E-Mail",
                "description": "An e-mail address.",
                "oneOf": [
                    {
                        "$schema": "https://blockprotocol.org/types/modules/graph/0.3/schema/data-type",
                        "$id": "https://blockprotocol.org/@blockprotocol/types/data-type/text/v/1",
                        "kind": "dataType",
                        "title": "Text",
                        "description": "An ordered sequence of characters",
                        "type": "string",
                    },
                ],
            },
        },
    }

    try:

        class EmployeeEncoder(json.JSONEncoder):
            def default(self, o):
                return o.dict(by_alias=True)

        print(json.dumps(CollapsedEntityType(**type).openai_schema(), indent=2))
        return ""
    except ValidationError as e:
        print(e)
        return str(e)
