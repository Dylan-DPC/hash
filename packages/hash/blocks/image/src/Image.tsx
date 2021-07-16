import React, { VoidFunctionComponent } from "react";

// @todo make calling it AppProps not necessary
type AppProps = {
  width?: number;
  height?: number;
  src?: string;
};

export const Image: VoidFunctionComponent<AppProps> = ({
  src = "https://via.placeholder.com/350x150",
  ...props
}) => <img {...props} src={src} alt="Image block" />;
