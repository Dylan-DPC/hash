
from langchain import PromptTemplate
from langchain.chat_models import ChatOpenAI
from langchain.chains import LLMChain
from langchain.chains.base import Chain

from .io_types import *

from typing import Dict, List


"""
This example-agent shows how to combine two LLMChains into a single chain. 
The example is directly taken from:
https://python.langchain.com/en/latest/modules/chains/getting_started.html#create-a-custom-chain-with-the-chain-class

and shows how our agent abstraction is fairly thin and doesn't require much change to the code.
"""

class ConcatenateChain(Chain):
    chain_1: LLMChain
    chain_2: LLMChain

    @property
    def input_keys(self) -> List[str]:
        # Union of the input keys of the two chains.
        all_input_vars = set(self.chain_1.input_keys).union(set(self.chain_2.input_keys))
        return list(all_input_vars)

    @property
    def output_keys(self) -> List[str]:
        return ['concat_output']

    def _call(self, inputs: Dict[str, str]) -> Dict[str, str]:
        output_1 = self.chain_1.run(inputs)
        output_2 = self.chain_2.run(inputs)
        return {'concat_output': output_1 + output_2}

def call_chain(inp, llm):
    prompt_1 = PromptTemplate(
        input_variables=["product"],
        template="What is a good name for a company that makes {product}?",
    )
    chain_1 = LLMChain(llm=llm, prompt=prompt_1)

    prompt_2 = PromptTemplate(
        input_variables=["product"],
        template="What is a good slogan for a company that makes {product}?",
    )
    chain_2 = LLMChain(llm=llm, prompt=prompt_2)

    concat_chain = ConcatenateChain(chain_1=chain_1, chain_2=chain_2)
    return concat_chain.run(inp)

def main(agent_input: Input) -> Output:
    llm = ChatOpenAI(model_name="gpt-3.5-turbo", temperature=0)
    result = call_chain(agent_input.idea, llm)
    return Output(name_and_slogan==result)


if __name__ == "HASH":
    """This is used when running the agent from the server or the agent orchestrator"""

    # `IN` and `OUT` are defined by the agent orchestrator
    global IN, OUT
    OUT = main(IN)

if __name__ == "__main__":
    """This is used when running the agent from the command line"""
    from ... import setup
    from logging import getLogger

    setup()

    output = main(Input(idea="colorful socks"))
    getLogger().info(f"output: {output.result}")

