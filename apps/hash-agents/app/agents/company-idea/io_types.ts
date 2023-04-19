/**
 * Example chained agent.
 * Given an idea as input, it will find a company name and slogan and output it together.
 */

/**
 * Input for chained agent.
 */
export type Input = {
  idea: string;
};

export type Output = {
  nameAndSlogan: string;
};
