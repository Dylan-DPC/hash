import { ApolloError } from "apollo-server-express";

import {
  MutationSendLoginCodeArgs,
  VerificationCodeMetadata,
  Resolver,
} from "../../apiTypes.gen";
import { GraphQLContext } from "../../context";
import { GraphQLPasswordlessStrategy } from "../../../auth/passport/PasswordlessStrategy";
import { sendLoginCodeToEmailAddress } from "../../../email";

export const sendLoginCode: Resolver<
  Promise<VerificationCodeMetadata>,
  {},
  GraphQLContext,
  MutationSendLoginCodeArgs
> = async (_, { emailOrShortname }, { dataSources }) => {
  const providedEmail = emailOrShortname.includes("@");

  const user = providedEmail
    ? await dataSources.db
        .getUserByEmail({ email: emailOrShortname })
        .then((user) => {
          if (!user)
            throw new ApolloError(
              `A user with the email '${emailOrShortname}' could not be found.`,
              "NOT_FOUND"
            );
          return user;
        })
    : await dataSources.db
        .getUserByShortname({ shortname: emailOrShortname })
        .then((user) => {
          if (!user)
            throw new ApolloError(
              `A user with the shortname '${emailOrShortname}' could not be found.`,
              "NOT_FOUND"
            );
          return user;
        });

  const verificationCode = await dataSources.db.createVerificationCode({
    accountId: user.accountId,
    userId: user.entityId,
    code: GraphQLPasswordlessStrategy.generateLoginCode(),
  });

  const verificationEmail = providedEmail
    ? emailOrShortname
    : user.properties.emails.find(({ primary }) => primary === true)!.address;

  return sendLoginCodeToEmailAddress(verificationCode, verificationEmail).then(
    () => ({
      id: verificationCode.id,
      createdAt: verificationCode.createdAt,
    })
  );
};
