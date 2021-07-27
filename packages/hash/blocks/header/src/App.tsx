import React, { RefCallback } from "react";

import { BlockComponent } from "@hashintel/block-protocol/react";

type AppProps = {
  color?: string;
  level?: number;
  editableRef?: RefCallback<HTMLElement>;
};

export const App: BlockComponent<AppProps> = ({
  color,
  level = 1,
  editableRef,
}) => {
  // @todo set type correctly
  const Header = `h${level}` as any;

  return (
    <Header
      style={{ fontFamily: "Arial", color: color ?? "black", marginBottom: 0 }}
      ref={editableRef}
    />
  );
};
