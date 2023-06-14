"""Temporal workflow definitions."""
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .activities import complete, math


@workflow.defn
class DemoWorkflowPy:
    """A workflow that uses the OpenAI API to complete a prompt."""

    @workflow.run
    async def run(self, prompt: str) -> str:
        """Execute the `complete` activity with the given `prompt`."""
        return await workflow.execute_activity(
            complete,
            prompt,
            start_to_close_timeout=timedelta(seconds=2),
        )


@workflow.defn
class MathWorkflow:
    """A workflow that uses the OpenAI API to complete a prompt."""

    @workflow.run
    async def run(self, prompt: str) -> str:
        print(f"Prompt: {prompt}")
        """Execute the `complete` activity with the given `prompt`."""
        return await workflow.execute_activity(
            math,
            prompt,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
