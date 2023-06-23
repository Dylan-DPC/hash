"""Temporal workflow definitions."""
from datetime import timedelta
from app.type_system import CollapsedEntityType

from temporalio import workflow
from temporalio.common import RetryPolicy
import json

with workflow.unsafe.imports_passed_through():
    from .activities import math


@workflow.defn(name="createEntities")
class MathWorkflow:
    """A workflow that uses the OpenAI API to complete a prompt."""

    @workflow.run
    async def run(
        self,
        entity_type_ids: list[str],
        depth: int,
        prompt_path: str,
    ) -> str:
        entity_types = await workflow.execute_child_workflow(
            task_queue="ai",
            workflow="createCollapsedEntityTypes",
            arg={
                "entityTypeIds": entity_type_ids,
                "depth": depth,
            },
        )

        # with open(prompt_path) as prompt_file:
        #     prompt = prompt_file.read()
        #     print(prompt)

        if isinstance(entity_types, list):
            for entityType in entity_types:
                print(
                    json.dumps(
                        CollapsedEntityType(**entityType).openai_schema(), indent=4
                    )
                )
        return "finished"

        print(f"Prompt: {prompt}")
        """Execute the `complete` activity with the given `prompt`."""
        return await workflow.execute_activity(
            math,
            prompt,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
