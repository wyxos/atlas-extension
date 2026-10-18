<script setup>
import { X } from "@lucide/vue";
import { reactionOptions } from "./reaction-options.js";

defineProps({
  picker: {
    type: Object,
    required: true,
  },
});

defineEmits(["dismiss", "pick"]);
</script>

<template>
  <div
    v-if="picker.visible"
    class="atlas-drop-picker"
    data-atlas-drop-picker="true"
    :data-default-reaction="picker.defaultReaction"
    role="dialog"
    aria-label="Choose an Atlas reaction"
  >
    <div class="atlas-drop-picker-header">
      <span class="atlas-drop-picker-title">Save to Atlas as…</span>
      <button
        type="button"
        class="atlas-drop-picker-dismiss"
        aria-label="Use default reaction"
        title="Use default reaction"
        @click.stop.prevent="$emit('dismiss')"
      >
        <X :size="14" :stroke-width="2" />
      </button>
    </div>
    <span class="atlas-drop-picker-detail">{{ picker.label }}</span>
    <div class="atlas-static-icons">
      <button
        v-for="reaction in reactionOptions"
        :key="reaction.type"
        type="button"
        class="atlas-static-icon"
        :class="{
          'atlas-static-icon-active': picker.defaultReaction === reaction.type,
          [`atlas-static-icon-${reaction.type}`]: true,
        }"
        :aria-label="reaction.label"
        :title="reaction.label"
        :data-reaction="reaction.type"
        @click.stop.prevent="$emit('pick', reaction.type)"
      >
        <component :is="reaction.icon" :size="18" :stroke-width="2" />
      </button>
    </div>
    <span class="atlas-drop-picker-hint" data-atlas-drop-picker-hint="true">{{ picker.hint }}</span>
    <span class="atlas-drop-picker-timer" aria-hidden="true">
      <span :key="picker.token" :style="{ animationDuration: `${picker.timeoutMs}ms` }" />
    </span>
  </div>
</template>
