"""Temporal activities available to workflows."""
import os

import openai
from langchain.llms import OpenAI
from temporalio import activity


@activity.defn
async def complete(prompt: str) -> str:
    """Completes a prompt using the OpenAI API."""
    openai.api_key = os.environ.get("OPENAI_API_KEY")
    completion = await openai.Completion.acreate(
        model="ada",
        prompt=prompt,
        temperature=0,
        max_tokens=10,
    )

    # We suspect that due to the Temporal decorator, we must explicitly bind
    # the return value before returning it.
    # If we don't do this, the activity will mysteriously fail.
    text_response = completion["choices"][0]["text"]

    return text_response  # noqa: RET504


@activity.defn
async def math(prompt: str) -> str:
    llm = OpenAI(model_name="gpt-4", temperature=0.5)
    resp = await llm.agenerate([prompt])
    print(resp)
    print(resp.generations[0])
    return resp.generations[0][0].text
