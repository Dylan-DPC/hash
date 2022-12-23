import { CodegenConfig } from "@graphql-codegen/cli";
import { scalars } from "@hashintel/hash-shared/graphql/scalar-mapping";

const config: CodegenConfig = {
  overwrite: true,
  schema: "../api/src/graphql/type-defs/**/*.ts",
  generates: {
    "./src/graphql/fragmentTypes.gen.json": {
      plugins: ["fragment-matcher"],
    },
    "./src/graphql/api-types.gen.ts": {
      plugins: ["typescript", "typescript-operations"],
      documents: [
        "./src/graphql/queries/**/*.ts",
        "../shared/src/queries/**/*.ts",
      ],
      config: {
        skipTypename: true,
        // Use shared scalars
        scalars,
      },
    },
  },
};

// eslint-disable-next-line import/no-default-export
export default config;
