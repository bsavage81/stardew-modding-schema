// src/itemHoverConfig.ts

/**
 * Numeric-valued JSON property names where we do NOT want to treat the value
 * as an item ID for hover purposes (outside UnlockableBundles).
 *
 * These are things like prices, sprite indexes, stack counts, etc.
 */
export const NUMERIC_KEYS_NO_ITEM_HOVER: string[] = [
  "Category",
  "Price",
  "SpriteIndex",
  "RequiredCount",
  "MinutesUntilReady",
  "MinStack",
  "Edibility",
  "MaxStamina",
  "Duration",
  "FarmingLevel",
  "LuckLevel",
  "Speed",
  "FishingLevel",
  "MiningLevel",
  "Immunity",
  "Defense",
  "Attack",
  "ForagingLevel",
  "MagneticRadius",
  "CriticalChanceMultiplier",
  "CriticalPowerMultiplier",
  "WeaponSpeedMultiplier",
  "AttackMultiplier",
  "KnockbackMultiplier",
  "IconSpriteIndex",
];

/**
 * Prefix-based keys that should also disable numeric item hover.
 * Useful for namespaced or dynamically suffixed config keys.
 */
export const NUMERIC_KEY_PREFIXES_NO_ITEM_HOVER: string[] = [
  "selph.ExtraMachineConfig.RequirementCount.1",
  "selph.ExtraMachineConfig.RequirementCount.2",
  "spacechase0.SpaceCore/StaminaRegeneration",
];
