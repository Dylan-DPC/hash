import { QueueExclusiveConsumer } from "@hashintel/hash-backend-utils/queue/adapter";
import { Repeater } from "@hashintel/hash-backend-utils/timers";
import { entityStoreFromProsemirror } from "@hashintel/hash-shared/entityStorePlugin";
import { createApolloClient } from "@hashintel/hash-shared/graphql/createApolloClient";
import { json } from "body-parser";
import corsMiddleware from "cors";
import express, { Request, Response } from "express";
import { ApolloClient, NormalizedCacheObject } from "@apollo/client";
import { ApolloError } from "apollo-server-express";
import LRU from "lru-cache";
import { getBasicWhoAmI } from "@hashintel/hash-shared/queries/auth.queries";
import nocache from "nocache";
import {
  AuthenticationError,
  InvalidRequestPayloadError,
  InvalidVersionError,
} from "./errors";
import { CORS_CONFIG } from "../lib/config";
import { logger } from "../logger";
import { EntityWatcher } from "./EntityWatcher";
import { getInstance, Instance } from "./Instance";
import { COLLAB_QUEUE_NAME } from "./util";
import { Waiting } from "./Waiting";

const handleError = (response: Response, error: unknown) => {
  console.error(error);
  response
    .status(
      error instanceof AuthenticationError
        ? 401
        : error instanceof InvalidRequestPayloadError
        ? 400
        : 500,
    )
    .send(`${error}`);
};

const parseVersion = (rawValue: Request["query"][string]) => {
  const num = Number(rawValue);
  if (!Number.isNaN(num) && Math.floor(num) === num && num >= 0) return num;

  throw new InvalidVersionError(rawValue);
};

const jsonEvents = (
  instance: Instance,
  data: Exclude<ReturnType<Instance["getEvents"]>, boolean>,
) => ({
  version: instance.version,
  steps: data.steps.map((step) => step.toJSON()),
  clientIDs: data.clientIDs,
  users: data.users,
  store: data.store,
});

interface UserInfo {
  entityId: string;
  shortname: string;
  preferredName: string;
}

const requestUserInfo = async (
  apolloClient: ApolloClient<NormalizedCacheObject>,
): Promise<UserInfo> => {
  try {
    const {
      data: { me },
    } = await apolloClient.query({
      query: getBasicWhoAmI,
      errorPolicy: "none",
    });

    return {
      entityId: me.entityId,
      shortname: me.properties.shortname,
      preferredName: me.properties.preferredName,
    };
  } catch (error) {
    if (error instanceof ApolloError && error.extensions.code === "FORBIDDEN") {
      throw new AuthenticationError(error.message);
    }
    throw error;
  }
};

interface SessionSupport {
  apolloClient: ApolloClient<NormalizedCacheObject>;
  userInfo: UserInfo;
}

export const createCollabApp = async (queue: QueueExclusiveConsumer) => {
  logger.info(`Acquiring read ownership on queue "${COLLAB_QUEUE_NAME}" ...`);

  const repeater = new Repeater(async () => {
    const res = await queue.acquire(COLLAB_QUEUE_NAME, 5_000);
    if (!res) {
      logger.info(
        "Queue is owned by another consumer. Attempting to acquire ownership again ...",
      );
    }
    return res;
  });
  await repeater.start();

  const entityWatcher = new EntityWatcher(queue);

  /**
   * @todo handle this
   */
  entityWatcher.start().catch((err) => {
    logger.error("Error in entity watcher", err);
  });

  const sessionSupportCache = new LRU<string, SessionSupport>({
    max: 1000,
    maxAge: 1000 * 60 * 5,
    dispose: (_, { apolloClient }) => {
      apolloClient.stop();
    },
  });

  const prepareSessionSupport = async (
    cookie: string | undefined,
  ): Promise<SessionSupport> => {
    if (!cookie) {
      throw new AuthenticationError("Expected authentication cookie");
    }

    const cacheRecord = sessionSupportCache.get(cookie);
    if (cacheRecord) {
      return cacheRecord;
    }

    const apolloClient = createApolloClient({
      name: "collab",
      additionalHeaders: { Cookie: cookie },
    });

    const userInfo = await requestUserInfo(apolloClient);

    const newCacheRecord: SessionSupport = {
      apolloClient,
      userInfo,
    };

    sessionSupportCache.set(cookie, newCacheRecord);

    return newCacheRecord;
  };

  const prepareSessionSupportWithInstance = async (
    request: Request,
  ): Promise<SessionSupport & { instance: Instance }> => {
    const { apolloClient, userInfo } = await prepareSessionSupport(
      request.headers.cookie,
    );

    const instance = await getInstance(apolloClient, entityWatcher)(
      request.params.accountId,
      request.params.pageEntityId,
      userInfo.entityId,
    );

    return {
      apolloClient,
      userInfo,
      instance,
    };
  };

  const collabApp = express();

  collabApp.use(json({ limit: "16mb" }));
  collabApp.use(corsMiddleware(CORS_CONFIG));
  collabApp.use(nocache());

  collabApp.get("/:accountId/:pageEntityId", async (request, response) => {
    try {
      const { instance } = await prepareSessionSupportWithInstance(request);

      response.json({
        doc: instance.state.doc.toJSON(),
        store: entityStoreFromProsemirror(instance.state).store,
        users: instance.userCount,
        version: instance.version,
      });
    } catch (error) {
      handleError(response, error);
    }
  });

  collabApp.get(
    "/:accountId/:pageEntityId/events",
    async (request, response) => {
      try {
        const { instance, userInfo } = await prepareSessionSupportWithInstance(
          request,
        );
        const version = parseVersion(request.query.version);
        const data = instance.getEvents(version);

        if (data === false) {
          response.status(410).send("History no longer available");
          return;
        }
        // If the server version is greater than the given version,
        // return the data immediately.
        if (data.steps.length) return response.json(jsonEvents(instance, data));
        // If the server version matches the given version,
        // wait until a new version is published to return the event data.
        const wait = new Waiting(response, instance, userInfo.entityId, () => {
          const events = instance.getEvents(version);
          if (events === false) {
            response.status(410).send("History no longer available");
            return;
          }

          wait.send(jsonEvents(instance, events));
        });
        instance.waiting.push(wait);
        response.on("close", () => wait.abort());
      } catch (error) {
        handleError(response, error);
      }
    },
  );

  collabApp.post(
    "/:accountId/:pageEntityId/events",
    async (request, response) => {
      try {
        const { apolloClient, instance } =
          await prepareSessionSupportWithInstance(request);

        // @todo type this
        const data: any = request.body;
        const version = parseVersion(data.version);

        const result = await instance.addJsonEvents(apolloClient)(
          version,
          data.steps,
          data.clientID,
          data.blockIds,
        );
        if (!result) {
          response.status(409).send("Version not current");
        } else {
          response.json(result);
        }
      } catch (error) {
        handleError(response, error);
      }
    },
  );

  collabApp.get(
    "/:accountId/:pageEntityId/positions",
    async (request, response) => {
      try {
        const { instance, userInfo } = await prepareSessionSupportWithInstance(
          request,
        );
        const poll =
          request.query.poll === "true" || request.query.poll === "1";

        if (!poll) {
          response.json(instance.extractPositions(userInfo.entityId));
          return;
        }

        instance.addPositionPoller({
          baselinePositions: instance.extractPositions(userInfo.entityId),
          userIdToExclude: userInfo.entityId,
          response,
        });
      } catch (error) {
        handleError(response, error);
      }
    },
  );

  collabApp.post(
    "/:accountId/:pageEntityId/report-position",
    async (request, response) => {
      try {
        const { instance, userInfo } = await prepareSessionSupportWithInstance(
          request,
        );

        const { entityId } = request.body;

        if (typeof entityId !== "string" && entityId !== null) {
          throw new InvalidRequestPayloadError(
            "Expected entityId to be a string or null",
          );
        }

        instance.registerPosition({
          userId: userInfo.entityId,
          userShortname: userInfo.shortname,
          userPreferredName: userInfo.preferredName,
          entityId,
        });

        response.status(200).send("OK");
      } catch (error) {
        handleError(response, error);
      }
    },
  );

  return {
    router: collabApp,
    stop() {
      entityWatcher.stop();

      // Proactively dispose all cached apollo clients
      sessionSupportCache.reset();
    },
  };
};
