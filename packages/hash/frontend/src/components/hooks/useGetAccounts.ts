import { useMemo } from "react";
import { useQuery } from "@apollo/client";
import { GetAccountsQuery } from "../../graphql/apiTypes.gen";
import { getAccounts } from "../../graphql/queries/account.queries";

export const useGetAccounts = () => {
  const { data, loading } = useQuery<GetAccountsQuery>(getAccounts);

  const accounts = useMemo(() => {
    if (!data) return [];
    /**
     * Filter out org accounts
     * org accounts do not have "preferredName" in their properties object
     */
    const userAccounts = data.accounts.filter(
      (account) => account.__typename === "User",
    );

    console.log({ userAccounts });

    return userAccounts.map((account) => {
      return {
        entityId: account.entityId,
        shortname: account.properties.shortname!,
        name: account.properties.preferredName ?? account.properties.shortname,
      };
    });
  }, [data]);

  return {
    loading,
    data: accounts,
  };
};
