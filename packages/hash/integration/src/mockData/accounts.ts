import { GraphQLClient } from "graphql-request";

import {
  CreateUserMutationVariables,
  CreateOrgMutationVariables,
  CreateOrgMutation,
  CreateUserMutation,
} from "../graphql/apiTypes.gen";
import { createUser } from "../../../frontend/src/graphql/queries/user.queries";
import { createOrg } from "../../../frontend/src/graphql/queries/org.queries";

export const createUsers = async (client: GraphQLClient) => {
  const users: CreateUserMutationVariables[] = [
    {
      email: "aj@hash.ai",
      shortname: "akash",
    },
    {
      email: "c@hash.ai",
      shortname: "ciaran",
    },
    {
      email: "d@hash.ai",
      shortname: "david",
    },
    {
      email: "ef@hash.ai",
      shortname: "eadan",
    },
    {
      email: "nh@hash.ai",
      shortname: "nate",
    },
    {
      email: "mr@hash.ai",
      shortname: "marius",
    },
    {
      email: "bw@hash.ai",
      shortname: "ben",
    },
    {
      email: "vu@hash.ai",
      shortname: "valentino",
    },
  ];

  const userResults = await Promise.all(
    users.map(
      async (user) => await client.request<CreateUserMutation>(createUser, user)
    )
  );

  return userResults.map((user) => user.createUser);
};

export const createOrgs = async (client: GraphQLClient) => {
  const orgs: CreateOrgMutationVariables[] = [
    {
      shortname: "hash",
    },
  ];

  const orgResults = await Promise.all(
    orgs.map(
      async (org) => await client.request<CreateOrgMutation>(createOrg, org)
    )
  );

  return orgResults.map((org) => org.createOrg);
};
