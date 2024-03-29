import {
  PointerTypes,
  SchemaRoot,
  getReferencedObject,
  makeQueryRef,
} from "./floro-generator-schema-api";
//@ts-ignore
import floroGeneratorFile from "../floro/floro.generator.json" assert {type: "json"};
import path from "path";
import fs from "fs";
import {
  quicktype,
  InputData,
  JSONSchemaInput,
  TypeScriptTargetLanguage,
} from "quicktype-core";
import { svgRemap } from "./get-json";
export { getJSON } from "./get-json";

type Languages = "typescript";

export function filename() {
  return __filename;
}

export function getFloroGenerator() {
  return floroGeneratorFile;
}

const findHexIndicesInSvg = (svg: string, hexcode: string) => {
  const out: Array<number> = [];
  for (let i = 0; i < svg.length; ++i) {
    if (
      svg[i] == hexcode[0] &&
      svg.substring(i, i + hexcode.length) == hexcode
    ) {
      out.push(i);
    }
  }
  return out;
};

const replaceHexIndicesInSvg = (
  svg: string,
  indices: Array<number>,
  replacementHex: string
) => {
  const outSvg = svg.split("");
  for (const index of indices) {
    for (let i = 0; i < replacementHex.length; ++i) {
      outSvg[index + i] = replacementHex[i];
    }
  }
  return outSvg.join("");
};

const rethemeSvg = (
  applicationState: SchemaRoot,
  svg: string,
  appliedThemes: { [key: string]: PointerTypes["$(theme).themeColors.id<?>"] },
  themeRef: PointerTypes["$(theme).themes.id<?>"],
  themeColorRef?: PointerTypes["$(theme).themeColors.id<?>"] | null,
  themingHex?: string | null,
  stateVariantRef?: PointerTypes["$(theme).stateVariants.id<?>"],
  alpha: number = 255
): string => {
  const alphaHex = alpha.toString(16).toUpperCase().padStart(2, "0");
  const rethemedSvg = Object.keys(appliedThemes).reduce((s, hexcode) => {
    if (themingHex && hexcode == themingHex) {
      return s;
    }
    const appliedTheme = getReferencedObject(
      applicationState,
      appliedThemes[hexcode]
    );

    if (!appliedTheme) {
      return s;
    }
    if (stateVariantRef && appliedTheme.includeVariants) {
      const themedVariantRef = makeQueryRef(
        "$(theme).themeColors.id<?>.variants.id<?>.variantDefinitions.id<?>",
        appliedTheme.id,
        stateVariantRef,
        themeRef
      );
      const themedVariant = getReferencedObject(
        applicationState,
        themedVariantRef
      );
      const paletteColor = getReferencedObject(
        applicationState,
        themedVariant?.paletteColorShade
      );
      if (paletteColor?.hexcode) {
        const alphaHex = Math.round(themedVariant?.alpha ?? 255)
          .toString(16)
          .padStart(2, "0");
        const indices = findHexIndicesInSvg(svg, hexcode);
        return replaceHexIndicesInSvg(
          s,
          indices,
          paletteColor?.hexcode + alphaHex
        );
      }
    }
    const themeDefRef = makeQueryRef(
      "$(theme).themeColors.id<?>.themeDefinitions.id<?>",
      appliedTheme.id,
      themeRef
    );
    const themeDef = getReferencedObject(applicationState, themeDefRef);
    const paletteColor = getReferencedObject(
      applicationState,
      themeDef?.paletteColorShade
    );
    if (paletteColor?.hexcode) {
      const alphaHex = Math.round(themeDef?.alpha ?? 255)
        .toString(16)
        .padStart(2, "0");

      const indices = findHexIndicesInSvg(svg, hexcode);
      return replaceHexIndicesInSvg(
        s,
        indices,
        paletteColor?.hexcode + alphaHex
      );
    }
    return s;
  }, svg);

  if (themingHex && themeColorRef) {
    const appliedTheme = getReferencedObject(applicationState, themeColorRef);
    if (appliedTheme) {
      if (stateVariantRef) {
        if (!appliedTheme) {
          return rethemedSvg;
        }
        const themedVariantRef = makeQueryRef(
          "$(theme).themeColors.id<?>.variants.id<?>.variantDefinitions.id<?>",
          appliedTheme?.id,
          stateVariantRef,
          themeRef
        );
        if (!appliedTheme.includeVariants) {
          return rethemedSvg;
        }
        const themedVariant = getReferencedObject(
          applicationState,
          themedVariantRef
        );
        const paletteColor = getReferencedObject(
          applicationState,
          themedVariant?.paletteColorShade
        );
        if (paletteColor?.hexcode) {
          const indices = findHexIndicesInSvg(svg, themingHex);
          return replaceHexIndicesInSvg(
            rethemedSvg,
            indices,
            paletteColor?.hexcode + alphaHex
          );
        }
      }

      const themeDefRef = makeQueryRef(
        "$(theme).themeColors.id<?>.themeDefinitions.id<?>",
        appliedTheme.id,
        themeRef
      );
      const themeDef = getReferencedObject(applicationState, themeDefRef);
      const paletteColor = getReferencedObject(
        applicationState,
        themeDef?.paletteColorShade
      );
      if (paletteColor?.hexcode) {
        const indices = findHexIndicesInSvg(svg, themingHex);
        return replaceHexIndicesInSvg(
          rethemedSvg,
          indices,
          paletteColor?.hexcode + alphaHex
        );
      }
    }
  }
  return rethemedSvg;
};

const shortHash = (str: string): string => {
  let hash = 0;
  str = str.padEnd(8, "0");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }
  return new Uint32Array([hash])[0].toString(16);
};

const GET_ICON = `
export const getIcon = <
  T extends keyof Icons,
  U extends keyof Theme,
  K extends keyof Icons[T]["variants"] | "default"
>(
  icons: Icons,
  themeName: U,
  iconKey: T,
  variant?: K
): string => {
  const defaultIcon = icons[iconKey].default[themeName];
  if (!variant || variant == "default") {
    return defaultIcon;
  }
  const icon = icons[iconKey] as Icons[T];
  return (
    icon.variants[variant as keyof typeof icon.variants][themeName] ??
    defaultIcon
  );
};
`.trim();

export async function generate(
  state: SchemaRoot,
  outDir: string,
  args: {
    lang: Languages;
    svgPreprocessor?: (svg: string) => Promise<string>;
  } = { lang: "typescript" },
  assetAccessor: (binaryRef: string) => Promise<Buffer | string | null>
) {
  const themes = getReferencedObject(state, "$(theme).themes");
  const iconGroups = getReferencedObject(state, "$(icons).iconGroups");
  const SCHEMA = {
    $schema: "http://json-schema.org/draft-06/schema#",
    $ref: "#/definitions/Icons",
    definitions: {
      Theme: {
        type: "object",
        properties: {},
        required: [] as string[],
        additionalProperties: false,
      },
      Icons: {
        type: "object",
        properties: {},
        required: [] as string[],
        additionalProperties: false,
      },
    },
  };
  const requiredThemes: string[] = [];
  for (const theme of themes) {
    SCHEMA.definitions.Theme.properties[theme.id] = {
      type: ["string"],
    };
    requiredThemes.push(theme.id);
  }
  SCHEMA.definitions.Theme.required = requiredThemes;
  const requiredIcons: string[] = [];
  for (const iconGroup of iconGroups) {
    const iconGroupId = iconGroup.id;
    for (const icon of iconGroup.icons) {
      const iconId = icon.id;
      const iconKey = `${iconGroupId}.${iconId}`;
      SCHEMA.definitions.Icons.properties[iconKey] = {
        type: "object",
        additionalProperties: false,
        required: ["default", "variants"],
        properties: {
          default: {
            $ref: "#/definitions/Theme",
          },
          variants: {
            type: "object",
            required: [],
            additionalProperties: false,
            properties: {},
          },
        },
      };
      const enabledVariantIds = icon.enabledVariants
        ?.filter((ev) => ev.enabled)
        .map((ev) => {
          return getReferencedObject(state, ev.id);
        })
        .map((s) => s.id);
      for (const enabledVariantId of enabledVariantIds) {
        SCHEMA.definitions.Icons.properties[
          iconKey
        ].properties.variants.properties[enabledVariantId] = {
          $ref: "#/definitions/Theme",
        };
        SCHEMA.definitions.Icons.properties[
          iconKey
        ].properties.variants.required.push(enabledVariantId);
      }
      requiredIcons.push(iconKey);
    }
  }
  SCHEMA.definitions.Icons.required = requiredIcons;

  const inputData = new InputData();
  const source = { name: "Icons", schema: JSON.stringify(SCHEMA) };
  await inputData.addSource(
    "schema",
    source,
    () => new JSONSchemaInput(undefined)
  );

  const iconsDir = path.join(outDir, "icons");
  await fs.promises.mkdir(iconsDir, { recursive: true });
  const paletteColors = state?.palette?.colorPalettes.flatMap((color) => {
    return color?.colorShades?.flatMap(colorShade => {
      return {
        hexcode: colorShade.hexcode,
        ref: makeQueryRef("$(palette).colorPalettes.id<?>.colorShades.id<?>", color.id, colorShade.id)
      }
    })
  })

  if (args.lang == "typescript") {
    let headTSCode = `import { Icons, Theme } from "./types";\n\n`;
    let bodyTSCode = `export default {\n`;
    let iconIndex = 0;
    const unlinkList: string[] = [];
    const safeFiles = new Set<string>();
    for (const iconGroup of iconGroups) {
      const iconGroupId = iconGroup.id;
      for (const icon of iconGroup.icons) {
        const iconId = icon.id;
        const iconKey = `${iconGroupId}.${iconId}`;
        const remappedColors = icon?.appliedPaletteColors?.reduce?.((acc, appliedPaletteColor) => {
          if (!appliedPaletteColor.paletteColor) {
            return {
              ...acc,
              [appliedPaletteColor.hexcode]: appliedPaletteColor.hexcode
            }
          }
          const paletteColor = getReferencedObject(state, appliedPaletteColor.paletteColor);
          return {
            ...acc,
            [appliedPaletteColor.hexcode]: paletteColor?.hexcode + 'FF'
          }
        }, {}) ?? {};
        const rawSvgData = (await assetAccessor(icon.svg)) as string;
        const svgData = svgRemap(rawSvgData, remappedColors);
        const appliedThemes = icon.appliedThemes.reduce((acc, appliedTheme) => {
          return {
            ...acc,
            [appliedTheme.hexcode]: appliedTheme.themeDefinition,
          };
        }, {});
        bodyTSCode += `  ["${iconKey}"]: {\n`;
        bodyTSCode += `    default: {\n`;
        for (const theme of themes) {
          const themeRef = makeQueryRef("$(theme).themes.id<?>", theme.id);
          const themedSvg = rethemeSvg(state, svgData, appliedThemes, themeRef);
          const preprocessedSvg =
            (await args?.svgPreprocessor?.(themedSvg)) ?? themedSvg;
          const hash = shortHash(preprocessedSvg);
          const iconFileName = `${iconKey}.default.${theme.id}.${hash}.svg`;
          const iconFilePath = path.join(iconsDir, iconFileName);
          await fs.promises.writeFile(iconFilePath, preprocessedSvg, "utf8");
          const iconName = `icon${iconIndex}`;

          const icons = await fs.promises.readdir(iconsDir);
          const regex = new RegExp(`${iconKey}.default.${theme.id}.[a-z0-9]+.svg`)
          const staleIcons = icons.filter(v => {
            if (regex.test(v) && v != iconFileName) {
              return true;
            }
            return false;
          }).map(f => path.join(iconsDir, f));
          safeFiles.add(iconFileName);
          unlinkList.push(...staleIcons);
          headTSCode += `import ${iconName} from './icons/${iconFileName}';\n`;
          bodyTSCode += `      ["${theme.id}"]: ${iconName},\n`;

          iconIndex++;
        }
        bodyTSCode += `    },\n`; // end defaults
        bodyTSCode += `    variants: {\n`;

        const enabledVariantIds = icon.enabledVariants
          ?.filter((ev) => ev.enabled)
          .map((ev) => {
            return getReferencedObject(state, ev.id);
          })
          .map((s) => s.id);
        for (const variantId of enabledVariantIds) {
          const variantRef = makeQueryRef(
            "$(theme).stateVariants.id<?>",
            variantId
          );
          bodyTSCode += `      ["${variantId}"]: {\n`;
          for (const theme of themes) {
            const themeRef = makeQueryRef("$(theme).themes.id<?>", theme.id);
            const variantSvg = rethemeSvg(
              state,
              svgData,
              appliedThemes,
              themeRef,
              null,
              null,
              variantRef
            );
            const preprocessedSvg =
              (await args?.svgPreprocessor?.(variantSvg)) ?? variantSvg;
            const hash = shortHash(preprocessedSvg);
            const iconFileName = `${iconKey}.${variantId}.${theme.id}.${hash}.svg`;
            const iconFilePath = path.join(iconsDir, iconFileName);
            await fs.promises.writeFile(iconFilePath, preprocessedSvg, "utf8");
            const icons = await fs.promises.readdir(iconsDir);
            const regex = new RegExp(`${iconKey}.${variantId}.${theme.id}.[a-z0-9]+.svg`)
            const staleIcons = icons.filter(v => {
              if (regex.test(v) && v != iconFileName) {
                return true;
              }
              return false;
            }).map(f => path.join(iconsDir, f));
            safeFiles.add(iconFileName);
            unlinkList.push(...staleIcons);
            const iconName = `icon${iconIndex}`;
            headTSCode += `import ${iconName} from './icons/${iconFileName}';\n`;
            bodyTSCode += `        ["${theme.id}"]: ${iconName},\n`;
            iconIndex++;
          }
          bodyTSCode += `      },\n`;
        }
        bodyTSCode += `    },\n`; // end variants
        bodyTSCode += `  },\n`;
      }
    }
    bodyTSCode += `} as unknown as Icons;`;

    const tsCode = `${headTSCode}\n${bodyTSCode}\n\n${GET_ICON}`;
    const indexFilePath = path.join(outDir, "index.ts");
    await fs.promises.writeFile(indexFilePath, tsCode, "utf-8");

    const lang = new TypeScriptTargetLanguage();
    const runtimeTypecheck = lang.optionDefinitions.find(
      (option) => option.name == "runtime-typecheck"
    );
    if (runtimeTypecheck) {
      runtimeTypecheck.defaultValue = false;
    }
    const { lines } = await quicktype({ lang, inputData });
    const typesCode = lines.join("\n");
    const typesFilePath = path.join(outDir, "types.ts");
    await fs.promises.writeFile(typesFilePath, typesCode, "utf-8");
    for (const file of unlinkList) {
      await fs.promises.rm(file);
    }
    const allIcons = await fs.promises.readdir(iconsDir);
    for (const file of allIcons) {
      if (!safeFiles.has(file)) {
        await fs.promises.rm(path.join(iconsDir, file));
      }
    }
  }
}