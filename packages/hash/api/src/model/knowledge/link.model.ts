import {
  GraphApi,
  KnowledgeGraphQuery,
  PersistedLink,
} from "@hashintel/hash-graph-client";

import { EntityModel, LinkModel, LinkTypeModel } from "../index";

export type LinkModelConstructorParams = {
  ownedById: string;
  index?: number;
  sourceEntityModel: EntityModel;
  linkTypeModel: LinkTypeModel;
  targetEntityModel: EntityModel;
};

export type LinkModelCreateParams = {
  createdById: string;
  index?: number;
  sourceEntityModel: EntityModel;
  linkTypeModel: LinkTypeModel;
  targetEntityModel: EntityModel;
};

/**
 * @class {@link LinkModel}
 */
export default class {
  ownedById: string;

  index?: number;

  sourceEntityModel: EntityModel;
  linkTypeModel: LinkTypeModel;
  targetEntityModel: EntityModel;

  constructor({
    ownedById,
    index,
    sourceEntityModel,
    linkTypeModel,
    targetEntityModel,
  }: LinkModelConstructorParams) {
    this.ownedById = ownedById;
    this.index = index;

    this.sourceEntityModel = sourceEntityModel;
    this.linkTypeModel = linkTypeModel;
    this.targetEntityModel = targetEntityModel;
  }

  static async fromPersistedLink(
    graphApi: GraphApi,
    {
      ownedById,
      inner: { sourceEntityId, targetEntityId, linkTypeId, index },
    }: PersistedLink,
  ): Promise<LinkModel> {
    const [sourceEntityModel, targetEntityModel, linkTypeModel] =
      await Promise.all([
        EntityModel.getLatest(graphApi, { entityId: sourceEntityId }),
        EntityModel.getLatest(graphApi, { entityId: targetEntityId }),
        LinkTypeModel.get(graphApi, { linkTypeId }),
      ]);

    return new LinkModel({
      ownedById,
      index,
      sourceEntityModel,
      linkTypeModel,
      targetEntityModel,
    });
  }

  static async getByQuery(
    graphApi: GraphApi,
    query: object,
    options?: Omit<Partial<KnowledgeGraphQuery>, "query">,
  ): Promise<LinkModel[]> {
    const { data: linkRootedSubgraphs } = await graphApi.getLinksByQuery({
      query,
      dataTypeQueryDepth: options?.dataTypeQueryDepth ?? 0,
      propertyTypeQueryDepth: options?.propertyTypeQueryDepth ?? 0,
      linkTypeQueryDepth: options?.linkTypeQueryDepth ?? 0,
      entityTypeQueryDepth: options?.entityTypeQueryDepth ?? 0,
      linkTargetEntityQueryDepth: options?.linkTargetEntityQueryDepth ?? 0,
      linkQueryDepth: options?.linkQueryDepth ?? 0,
    });

    return await Promise.all(
      linkRootedSubgraphs.map((linkRootedSubgraph) =>
        LinkModel.fromPersistedLink(graphApi, linkRootedSubgraph.link),
      ),
    );
  }

  /**
   * Create a link between a source and a target entity using a specific link
   * type, without modifying the indexes of its sibling links.
   *
   * @todo: deprecate this method when the Graph API handles updating the sibling indexes
   * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
   *
   * @param params.accountId the accountId of the account creating the link
   * @param params.sourceEntityModel the source entity of the link
   * @param params.linkTypeModel the Link Type of the link
   * @param params.targetEntityModel the target entity of the link
   */
  private static async createLinkWithoutUpdatingSiblings(
    graphApi: GraphApi,
    params: LinkModelCreateParams,
  ): Promise<LinkModel> {
    const {
      createdById,
      sourceEntityModel,
      linkTypeModel,
      targetEntityModel,
      index,
    } = params;

    const { data: link } = await graphApi.createLink(
      sourceEntityModel.entityId,
      {
        /**
         * @todo figure out what account ID we use here
         *   Directly related to
         *   https://app.asana.com/0/1202805690238892/1202883599104674/f
         *   And may require consideration for
         *   https://app.asana.com/0/1202805690238892/1202890446280569/f
         */
        ownedById: createdById,
        index,
        linkTypeId: linkTypeModel.schema.$id,
        targetEntityId: targetEntityModel.entityId,
      },
    );

    /**
     * @todo: this should be returned directly from the `createLink` method
     * @see https://app.asana.com/0/1202805690238892/1203045933021776/f
     */
    const persistedLink = {
      inner: link,
      ownedById: createdById,
    };

    return LinkModel.fromPersistedLink(graphApi, persistedLink);
  }

  /**
   * Create a link between a source and a target entity using a specific link
   * type.
   *
   * @param params.accountId the accountId of the account creating the link
   * @param params.sourceEntityModel the source entity of the link
   * @param params.linkTypeModel the Link Type of the link
   * @param params.targetEntityModel the target entity of the link
   */
  static async create(
    graphApi: GraphApi,
    params: LinkModelCreateParams,
  ): Promise<LinkModel> {
    const { sourceEntityModel, linkTypeModel, createdById } = params;
    const siblingLinks = await sourceEntityModel.getOutgoingLinks(graphApi, {
      linkTypeModel,
    });

    /**
     * @todo: rely on Graph API validation instead of performing this check here
     * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
     */
    const isOrdered = sourceEntityModel.entityTypeModel.isOutgoingLinkOrdered({
      outgoingLinkType: linkTypeModel,
    });

    if (!isOrdered && params.index !== undefined) {
      throw new Error(
        "Cannot create indexed link on un-ordered outgoing links",
      );
    }

    const index = isOrdered
      ? // if the link is ordered and an index is provided, use the provided index
        params.index ??
        // if the link is ordered and no index is provided, default to the end of the list of links
        siblingLinks.length
      : undefined;

    if (index !== undefined) {
      /**
       * @todo: rely on Graph API to validate the index
       * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
       */
      if (index < 0 || index > siblingLinks.length) {
        throw new Error("Provided link index is out of bounds");
      }

      await Promise.all(
        siblingLinks
          .filter((sibling) => sibling.index! >= index)
          .map((sibling) =>
            sibling.updateWithoutUpdatingSiblings(graphApi, {
              updatedIndex: sibling.index! + 1,
              updatedById: createdById,
            }),
          ),
      );
    }

    return await LinkModel.createLinkWithoutUpdatingSiblings(graphApi, {
      ...params,
      index,
    });
  }

  /**
   * Update the link without modifying the indexes of its sibling links.
   *
   * @todo: deprecate this method when the Graph API handles updating the sibling indexes
   * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
   *
   * @param params.updatedIndex - the updated index of the link
   * @param params.updatedbyId - the account updating the link
   */
  private async updateWithoutUpdatingSiblings(
    graphApi: GraphApi,
    params: { updatedIndex: number; updatedById: string },
  ) {
    const { updatedIndex, updatedById } = params;

    const { index: previousIndex } = this;

    if (previousIndex === undefined) {
      throw new Error("Cannot make an un-ordered link ordered");
    }

    if (previousIndex === updatedIndex) {
      throw new Error("No-op: link already has this index");
    }

    /**
     * @todo: call dedicated Graph API method to update the index of a link instead of re-creating the link manually
     * @see https://app.asana.com/0/1202805690238892/1203031430417465/f
     */
    await this.removeWithoutUpdatingSiblings(graphApi, {
      removedById: updatedById,
    });

    const updatedLink = await LinkModel.createLinkWithoutUpdatingSiblings(
      graphApi,
      {
        ...this,
        index: updatedIndex,
        createdById: updatedById,
      },
    );

    return updatedLink;
  }

  /**
   * Update the link
   *
   * @param params.updatedIndex - the updated index of the link
   * @param params.updatedbyId - the account updating the link
   */
  async update(
    graphApi: GraphApi,
    params: { updatedIndex: number; updatedById: string },
  ) {
    const { updatedIndex, updatedById } = params;

    const { index: previousIndex, linkTypeModel } = this;

    /**
     * @todo: rely on Graph API validation instead of performing this check here
     * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
     */
    const isOrdered =
      this.sourceEntityModel.entityTypeModel.isOutgoingLinkOrdered({
        outgoingLinkType: linkTypeModel,
      });

    if (!isOrdered) {
      throw new Error("Cannot update the index of an un-ordered link");
    }

    const siblingLinks = await this.sourceEntityModel.getOutgoingLinks(
      graphApi,
      { linkTypeModel },
    );

    if (previousIndex === undefined) {
      throw new Error("Critical: existing ordered link doesn't have an index");
    }

    // Whether the index of the link is being increased
    const isIncreasingIndex = updatedIndex > previousIndex;

    // The minimum index of the affected sibling links
    const affectedSiblingsMinimumIndex = isIncreasingIndex
      ? previousIndex + 1
      : updatedIndex;

    // The maximum index of the affected sibling links
    const affectedSiblingsMaximumIndex = isIncreasingIndex
      ? updatedIndex
      : previousIndex - 1;

    const affectedSiblings = siblingLinks.filter(
      (sibling) =>
        sibling.index! >= affectedSiblingsMinimumIndex &&
        sibling.index! <= affectedSiblingsMaximumIndex,
    );

    /**
     * @todo: rely on the Graph API to maintain index integrity of sibling links on updates
     * @see https://app.asana.com/0/1202805690238892/1203031430417465/f
     */
    await Promise.all(
      affectedSiblings.map((sibling) =>
        sibling.updateWithoutUpdatingSiblings(graphApi, {
          updatedIndex: sibling.index! + (isIncreasingIndex ? -1 : 1),
          updatedById,
        }),
      ),
    );

    return await this.updateWithoutUpdatingSiblings(graphApi, {
      updatedIndex,
      updatedById,
    });
  }

  /**
   * Remove the link without modifying the indexes of its sibling links.
   *
   * @todo: deprecate this method when the Graph API handles updating the sibling indexes
   * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
   *
   * @param removedById - the account removing the link
   */
  private async removeWithoutUpdatingSiblings(
    graphApi: GraphApi,
    { removedById }: { removedById: string },
  ): Promise<void> {
    await graphApi.removeLink(this.sourceEntityModel.entityId, {
      linkTypeId: this.linkTypeModel.schema.$id,
      targetEntityId: this.targetEntityModel.entityId,
      removedById,
    });
  }

  /**
   * Remove the link.
   *
   * @param removedbyId - the account removing the link
   */
  async remove(
    graphApi: GraphApi,
    { removedById }: { removedById: string },
  ): Promise<void> {
    await graphApi.removeLink(this.sourceEntityModel.entityId, {
      linkTypeId: this.linkTypeModel.schema.$id,
      targetEntityId: this.targetEntityModel.entityId,
      removedById,
    });

    /**
     * @todo: rely on Graph API validation instead of performing this check here
     * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
     */
    const isOrdered =
      this.sourceEntityModel.entityTypeModel.isOutgoingLinkOrdered({
        outgoingLinkType: this.linkTypeModel,
      });

    if (isOrdered) {
      if (this.index === undefined) {
        throw new Error(
          "Critical: existing ordered link doesn't have an index",
        );
      }

      const siblingLinks = await this.sourceEntityModel.getOutgoingLinks(
        graphApi,
        {
          linkTypeModel: this.linkTypeModel,
        },
      );

      const affectedSiblings = siblingLinks.filter(
        (sibling) => sibling.index! > this.index!,
      );

      /**
       * @todo: rely on the Graph API to maintain index integrity of sibling links on updates
       * @see https://app.asana.com/0/1200211978612931/1203031430417465/f
       */
      await Promise.all(
        affectedSiblings.map((sibling) =>
          sibling.updateWithoutUpdatingSiblings(graphApi, {
            updatedIndex: sibling.index! - 1,
            updatedById: removedById,
          }),
        ),
      );
    }
  }
}
