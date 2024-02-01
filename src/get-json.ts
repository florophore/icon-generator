import {
  PointerTypes,
  SchemaRoot,
  getReferencedObject,
  makeQueryRef,
} from "./floro-generator-schema-api";

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

const encodeToSvg = (svg: string): string => {
  return `data:image/svg+xml,${encodeURIComponent(svg ?? "")}`;
};

export async function getJSON<T>(
  state: SchemaRoot,
  args?: {
    assetHost?: string;
    svgPreprocessor?: (svg: string) => Promise<string>;
  },
  mode?: "build" | "hot" | "live-update",
  assetAccessor?: (binaryRef: string) => Promise<string | Buffer | null>
): Promise<T> {
  const themes = getReferencedObject(state, "$(theme).themes");
  const iconGroups = getReferencedObject(state, "$(icons).iconGroups");
  const paletteColors = state?.palette?.colorPalettes.flatMap((color) => {
    return color?.colorShades?.flatMap(colorShade => {
      return {
        hexcode: colorShade.hexcode,
        ref: makeQueryRef("$(palette).colorPalettes.id<?>.colorShades.id<?>", color.id, colorShade.id)
      }
    })
  })
  const iconsObject = {};
  for (const iconGroup of iconGroups) {
    const iconGroupId = iconGroup.id;
    for (const icon of iconGroup.icons) {
      const iconId = icon.id;
      const iconKey = `${iconGroupId}.${iconId}`;
      iconsObject[iconKey] = {
        default: {},
        variants: {},
      };
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
      const svgDataRaw = (await assetAccessor?.(icon.svg)) as string;
      const svgData = svgRemap(svgDataRaw, remappedColors);
      const appliedThemes = icon.appliedThemes.reduce((acc, appliedTheme) => {
        return {
          ...acc,
          [appliedTheme.hexcode]: appliedTheme.themeDefinition,
        };
      }, {});

      for (const theme of themes) {
        const themeRef = makeQueryRef("$(theme).themes.id<?>", theme.id);
        const themedSvg = rethemeSvg(state, svgData, appliedThemes, themeRef);
        const preprocessedSvg =
          (await args?.svgPreprocessor?.(themedSvg)) ?? themedSvg;
        const hash = shortHash(preprocessedSvg);
        const iconFileName = `${iconKey}.default.${theme.id}.${hash}.svg`;
        if (mode == "live-update") {
          iconsObject[iconKey].default[theme.id] = `${
            args?.assetHost ?? ""
          }/${iconFileName}`;
        }
        if (mode == "hot") {
          iconsObject[iconKey].default[theme.id] = encodeToSvg(preprocessedSvg);
        }
      }

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
        for (const variantId of enabledVariantIds) {
          iconsObject[iconKey].variants[variantId] = {};
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
            if (mode == "live-update") {
              iconsObject[iconKey].variants[variantId][theme.id] = `${
                args?.assetHost ?? ""
              }/${iconFileName}`;
            }
            if (mode == "hot") {
              iconsObject[iconKey].variants[variantId][theme.id] =
                encodeToSvg(preprocessedSvg);
            }
          }
        }
      }
    }
  }
  return iconsObject as T;
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

export const svgRemap = (
  svgData: string|undefined|null,
  remap: { [color: string]: string }
) => {
  if (!svgData) {
    return "";
  }
  return Object.keys(remap).reduce((s, key) => {
    return s.replaceAll(key, remap[key]);
  }, svgData);
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