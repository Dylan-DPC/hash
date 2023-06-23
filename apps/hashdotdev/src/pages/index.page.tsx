import {
  Box,
  Container,
  Stack,
  StackProps,
  Typography,
  typographyClasses,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/system";
import type { NextPage } from "next";
import Image from "next/legacy/image";
import { ComponentProps, FunctionComponent, ReactNode } from "react";

import { Button } from "../components/button";
import { FaIcon } from "../components/icons/fa-icon";
import { Link } from "../components/link";
import { NAV_HEIGHT } from "../components/navbar";

const StylishDivider: FunctionComponent<
  ComponentProps<typeof Stack> & { wide?: boolean }
> = ({ wide = false, ...props }) => {
  const bgcolor = "teal.40";
  const size = 12;

  return (
    <Stack {...props} direction="row" alignItems="stretch" height={size}>
      <Box sx={{ width: 5 * size, bgcolor }} />
      <Box sx={{ width: 3 * size, bgcolor, opacity: 0.5 }} />
      <Box sx={{ width: 2 * size, bgcolor, opacity: 0.2 }} />
      {wide ? (
        <>
          <Box sx={{ width: size, bgcolor, opacity: 0 }} />
          <Box sx={{ width: size, bgcolor, opacity: 0.2 }} />
        </>
      ) : null}
    </Stack>
  );
};

const BlueStylishDivider: FunctionComponent<StackProps> = (props) => {
  const { palette } = useTheme();
  const size = 12;

  const boxDefinitions: { color: string; opacity?: number }[] = [
    { color: palette.turquoise[90] },
    { color: palette.turquoise[70] },
    { color: palette.turquoise[80] },
    { color: palette.turquoise[70] },
    { color: palette.turquoise[40] },
    { color: palette.turquoise[50], opacity: 0.5 },
    { color: palette.turquoise[40], opacity: 0.5 },
    { color: "#9EE9E4", opacity: 0.5 },
    { color: palette.turquoise[40], opacity: 0.2 },
    { color: palette.turquoise[40], opacity: 0.2 },
    { color: palette.turquoise[40] },
    { color: palette.turquoise[40], opacity: 0.2 },
  ];

  return (
    <Stack direction="row" alignItems="stretch" height={12} {...props}>
      {boxDefinitions.map(({ color, opacity }, i) => (
        <Box
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          sx={{
            width: size,
            height: size,
            background: color,
            opacity: opacity ?? 1,
          }}
        />
      ))}
    </Stack>
  );
};

const Hero: FunctionComponent = () => (
  <Box marginBottom={15}>
    <Box
      sx={{
        position: "absolute",
        background:
          "linear-gradient(0deg, rgba(255,255,255,1) 0%, rgba(237,252,255,1) 53%)",
        width: "100%",
        height: 500,
        top: -NAV_HEIGHT,
        zIndex: -1,
      }}
    />
    <Container>
      <Box width={{ xs: 1, md: 873 }}>
        <Typography variant="hashHeading4" component="h1" mb={3}>
          Open-source
        </Typography>
        <Typography
          variant="hashLargeTitle"
          component="h2"
          mb={5}
          sx={{ lineHeight: 1.1 }}
        >
          Help build the future of decision-making
        </Typography>
        <BlueStylishDivider mb={5} />
        <Box width={{ xs: 1, md: 725 }}>
          <Typography mb={2} sx={{ lineHeight: 1.5 }}>
            We’re building two open-source platforms in parallel — the{" "}
            <strong>Block Protocol</strong> and <strong>HASH</strong> — to help
            everybody make better decisions.
          </Typography>
          <Typography sx={{ lineHeight: 1.5 }}>
            Here you’ll find information about the technical architecture of the
            projects, as well as resources to help you build{" "}
            <strong>blocks</strong>, <strong>integrations</strong>,{" "}
            <strong>apps</strong> and <strong>simulations</strong>.
          </Typography>
        </Box>
      </Box>
    </Container>
  </Box>
);

const Project: FunctionComponent<{
  buttons: ReactNode;
  children?: ReactNode;
  image: ReactNode;
  mobileImage: ReactNode;
  title: ReactNode;
}> = ({ buttons, children, title, image, mobileImage }) => {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={{ xs: 4, md: 6, lg: 9 }}
    >
      <Box
        sx={[
          {
            width: { xs: 1, md: 420 },
            flexShrink: 0,
            [theme.breakpoints.down("md")]: { width: 1 },
            [theme.breakpoints.up("md")]: { width: 363 },
            [theme.breakpoints.up("lg")]: { width: 420 },
          },
        ]}
      >
        <Typography
          variant="hashHeading4"
          component="h4"
          sx={{ color: "black", fontWeight: 500, mb: 2 }}
        >
          {title}
        </Typography>
        <Stack
          sx={{
            lineHeight: 1.5,
            [`& .${typographyClasses.root}`]: { lineHeight: "inherit" },
          }}
          mb={3}
          spacing={3}
        >
          {children}
        </Stack>
        <Stack
          direction={{ xs: "column", lg: "row" }}
          alignItems="flex-start"
          spacing={1.5}
        >
          {buttons}
        </Stack>
      </Box>
      <Box flexShrink={0} fontSize={0} maxWidth={{ xs: 400, md: 1 }}>
        {mobile ? mobileImage : image}
      </Box>
    </Stack>
  );
};

const Projects: FunctionComponent<ComponentProps<typeof Stack>> = (props) => {
  return (
    <Container component="section">
      <Stack {...props} direction={{ xs: "column", lg: "row" }} spacing={6}>
        <Stack
          spacing={4}
          sx={[
            (theme) => ({
              [theme.breakpoints.down("lg")]: { width: 1 },
              [theme.breakpoints.up("lg")]: { mb: 6, flex: 1 },
            }),
          ]}
        >
          <Typography variant="hashHeading4" component="h3">
            Platforms
          </Typography>
          <StylishDivider />
        </Stack>
        <Stack flexShrink={0} spacing={{ xs: 8, md: 0 }}>
          <Project
            title={
              <Box display="flex" alignItems="center">
                <Image src="/home/bp-logo.svg" width={233} height={26} />
                <Box
                  sx={({ palette, spacing }) => ({
                    background: palette.purple[10],
                    color: palette.purple[60],
                    fontSize: "11px",
                    padding: spacing(0.25, 1),
                    borderRadius: 30,
                    marginLeft: 2,
                  })}
                >
                  v0.3
                </Box>
              </Box>
            }
            buttons={
              <Button
                href="https://blockprotocol.org"
                openInNew
                color="purple"
                endIcon={
                  <FaIcon name="arrow-up-right-from-square" type="solid" />
                }
              >
                Learn more
              </Button>
            }
            image={
              <Image
                src="/home/projects/bp.svg"
                width={445}
                height={238}
                alt="Blocks with pre-defined types allow you to create structured data"
              />
            }
            mobileImage={
              <Image
                layout="responsive"
                src="/home/projects/bp-mobile.svg"
                width={293}
                height={336}
                alt="Blocks with pre-defined types allow you to create structured data"
              />
            }
          >
            <Typography>
              The <strong>Block Protocol</strong> is an open standard for
              creating <i>blocks</i> which work in any application, without
              either block or app requiring any special knowledge of one
              another.
            </Typography>
            <Typography>
              Any application can integrate with the protocol’s public registry
              (
              <Link href="http://blockprotocol.com/hub">
                <Box
                  component="strong"
                  sx={{ color: ({ palette }) => palette.purple[70] }}
                >
                  Þ Hub
                </Box>
              </Link>
              ), enabling their users to discover and insert blocks at runtime,
              expanding the utility of applications that support the protocol
              way beyond their original programming.
            </Typography>
          </Project>
          <Project
            title={
              <Box
                sx={{ marginTop: 8.5, display: "flex", alignItems: "center" }}
              >
                <Image src="/home/hash-logo.svg" width={121} height={26} />
                <Box
                  sx={({ palette, spacing }) => ({
                    background: palette.blue[10],
                    color: palette.blue[80],
                    fontSize: "11px",
                    padding: spacing(0.25, 1),
                    borderRadius: 30,
                    marginLeft: 2,
                    textTransform: "uppercase",
                  })}
                >
                  Alpha
                </Box>
              </Box>
            }
            buttons={
              <Box>
                <Button
                  href="https://hash.ai"
                  openInNew
                  endIcon={
                    <FaIcon name="arrow-up-right-from-square" type="solid" />
                  }
                  sx={{ marginRight: 2, marginBottom: 2 }}
                >
                  Learn more
                </Button>
                <Button
                  href="https://github.com/hashintel/hash/tree/main/apps/hash"
                  openInNew
                  endIcon={<FaIcon name="github" type="brands " />}
                  variant="secondary"
                  sx={{ marginBottom: 2 }}
                >
                  View on GitHub
                </Button>
              </Box>
            }
            image={
              <Box
                sx={{
                  position: "relative",
                  zIndex: 1,
                  top: {
                    md: -192,
                    lg: -144,
                  },
                  left: -5,
                }}
              >
                <Image
                  src="/home/projects/hash.svg"
                  width={448}
                  height={855}
                  alt="Use Block Protocol blocks within the editor"
                />
              </Box>
            }
            mobileImage={
              <Image
                layout="responsive"
                src="/home/projects/hash-mobile.svg"
                width={288}
                height={617}
                alt="Use Block Protocol blocks within the editor"
              />
            }
          >
            <Typography>
              <strong>HASH</strong> is our open-source, all-in-one workspace
              platform built around structured data and interactive blocks.
            </Typography>
            <Box component="ul" sx={{ "> li": { marginBottom: 0 } }}>
              <Typography component="li">
                Model your environment with <strong>types</strong>
              </Typography>
              <Typography component="li">
                Seamlessly capture unstructured data and convert it into typed
                <strong>entities</strong>
              </Typography>
              <Typography component="li">
                Map external data to types and integrate it into your{" "}
                <strong>graph</strong>
              </Typography>
              <Typography component="li">
                Transform data and automate processes through{" "}
                <strong>flows</strong>
              </Typography>
              <Typography component="li">
                Use blocks with data to create <strong>apps</strong>
              </Typography>
              <Typography component="li">
                Use entities in <strong>simulations</strong>
              </Typography>
            </Box>
            <Typography>
              HASH is a flexible operating system built around your data, always
              up-to-date, and represented as you understand it.
            </Typography>
            <Typography>
              <strong>
                We’re currently helping onboard organizations interested in
                adopting HASH.
              </strong>
            </Typography>
          </Project>
        </Stack>
      </Stack>
    </Container>
  );
};

const Home: NextPage = () => {
  return (
    <>
      <Hero />
      <Projects />
    </>
  );
};

export default Home;
