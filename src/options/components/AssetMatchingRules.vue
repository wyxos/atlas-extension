<script setup>
import { computed } from "vue";
import { RotateCw } from "@lucide/vue";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldLabel } from "@ui/field";
import { Input } from "@ui/input";
import {
  assetMatchByValues,
  assetMatchQueryCleanupModes,
} from "../../shared/asset-source-preferences";

const props = defineProps({
  backfillStatus: {
    default: "",
    type: String,
  },
  disabled: {
    default: false,
    type: Boolean,
  },
  matching: {
    required: true,
    type: Object,
  },
});
const emit = defineEmits(["apply", "update"]);

const matchByOptions = [
  {
    label: "Source",
    value: assetMatchByValues.source,
  },
  {
    label: "Referrer",
    value: assetMatchByValues.referrer,
  },
];
const cleanupModeOptions = [
  {
    label: "None",
    value: assetMatchQueryCleanupModes.none,
  },
  {
    label: "Strip all",
    value: assetMatchQueryCleanupModes.stripAll,
  },
  {
    label: "Strip selected",
    value: assetMatchQueryCleanupModes.stripSelected,
  },
  {
    label: "Keep selected",
    value: assetMatchQueryCleanupModes.keepSelected,
  },
];

const cleanupParamsValue = computed(() => props.matching.cleanup.query.params.join(", "));
const cleanupNeedsParams = computed(() => [
  assetMatchQueryCleanupModes.keepSelected,
  assetMatchQueryCleanupModes.stripSelected,
].includes(props.matching.cleanup.query.mode));

function setAssetMatchBy(value) {
  emit("update", { matchBy: value });
}

function setCleanupMode(value) {
  emit("update", {
    cleanup: {
      ...props.matching.cleanup,
      query: {
        ...props.matching.cleanup.query,
        mode: value,
        params: paramsForCleanupMode(value, props.matching.cleanup.query.params),
      },
    },
  });
}

function setCleanupParams(value) {
  emit("update", {
    cleanup: {
      ...props.matching.cleanup,
      query: {
        ...props.matching.cleanup.query,
        params: normalizeParamInput(value),
      },
    },
  });
}

function setRemoveFragment(value) {
  emit("update", {
    cleanup: {
      ...props.matching.cleanup,
      removeFragment: value,
    },
  });
}

function paramsForCleanupMode(mode, currentParams) {
  return [
    assetMatchQueryCleanupModes.keepSelected,
    assetMatchQueryCleanupModes.stripSelected,
  ].includes(mode)
    ? currentParams
    : [];
}

function normalizeParamInput(value) {
  return [...new Set(
    String(value ?? "")
      .split(",")
      .map((param) => param.trim().toLowerCase())
      .filter((param) => param !== ""),
  )];
}
</script>

<template>
  <Field class="gap-2 border-t border-border pt-3">
    <FieldLabel>
      Match by
    </FieldLabel>
    <div class="grid max-w-md grid-cols-2 gap-2">
      <Button
        v-for="option in matchByOptions"
        :key="option.value"
        type="button"
        class="justify-start"
        :variant="matching.matchBy === option.value ? 'secondary' : 'outline'"
        :aria-pressed="matching.matchBy === option.value"
        :disabled="disabled"
        @click="setAssetMatchBy(option.value)"
      >
        {{ option.label }}
      </Button>
    </div>
  </Field>
  <Field class="gap-2">
    <FieldLabel>
      URL cleanup
    </FieldLabel>
    <div class="grid max-w-2xl grid-cols-2 gap-2 md:grid-cols-4">
      <Button
        v-for="option in cleanupModeOptions"
        :key="option.value"
        type="button"
        class="justify-start"
        :variant="matching.cleanup.query.mode === option.value ? 'secondary' : 'outline'"
        :aria-pressed="matching.cleanup.query.mode === option.value"
        :disabled="disabled"
        @click="setCleanupMode(option.value)"
      >
        {{ option.label }}
      </Button>
    </div>
  </Field>
  <Field v-if="cleanupNeedsParams" class="gap-1.5">
    <FieldLabel for="atlas-cleanup-params">
      Query params
    </FieldLabel>
    <Input
      id="atlas-cleanup-params"
      :model-value="cleanupParamsValue"
      autocomplete="off"
      class="h-7 max-w-lg text-sm"
      placeholder="fbid, set"
      @change="setCleanupParams($event.target.value)"
    />
  </Field>
  <Field class="gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        class="justify-start"
        :variant="matching.cleanup.removeFragment ? 'secondary' : 'outline'"
        :aria-pressed="matching.cleanup.removeFragment"
        :disabled="disabled"
        @click="setRemoveFragment(!matching.cleanup.removeFragment)"
      >
        Remove fragment
      </Button>
      <Button
        type="button"
        variant="outline"
        :disabled="disabled"
        @click="emit('apply')"
      >
        <RotateCw data-icon="inline-start" />
        Apply to existing files
      </Button>
    </div>
    <FieldDescription v-if="backfillStatus !== ''" class="text-xs">
      {{ backfillStatus }}
    </FieldDescription>
  </Field>
</template>
