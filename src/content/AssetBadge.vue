<script setup>
import {
  Ban,
  ExternalLink,
  Heart,
  ImageIcon,
  LoaderCircle,
  GripHorizontal,
  Smile,
  ThumbsUp,
  Trash2,
  Video,
  Volume2,
} from "@lucide/vue";
import { reactionFromBadgeShortcutEvent } from "./asset-shortcuts.js";
import { closeTabModes } from "../shared/close-tab-preferences.js";

defineProps({
  badge: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["batch-toggle", "close-mode-change", "delete", "open-file", "placement-change", "react"]);

const iconSize = 18;
const metaIconSize = 14;

const closeModeOptions = [
  {
    label: "Off",
    shortLabel: "Off",
    value: closeTabModes.off,
  },
  {
    label: "Close after queue",
    shortLabel: "Queue",
    value: closeTabModes.afterQueue,
  },
  {
    label: "Close on complete",
    shortLabel: "Done",
    value: closeTabModes.onComplete,
  },
];

const assetTypes = {
  audio: {
    icon: Volume2,
    label: "Audio",
  },
  image: {
    icon: ImageIcon,
    label: "Image",
  },
  video: {
    icon: Video,
    label: "Video",
  },
};

const reactions = [
  {
    icon: Heart,
    label: "Love",
    type: "love",
  },
  {
    icon: ThumbsUp,
    label: "Like",
    type: "like",
  },
  {
    icon: Ban,
    label: "Blacklist",
    type: "blacklist",
  },
  {
    icon: Smile,
    label: "Funny",
    type: "funny",
  },
];

let dragPointerId = null;

function beginDrag(event) {
  dragPointerId = event.pointerId;
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  emitPlacement(event, false);
}

function continueDrag(event) {
  if (dragPointerId === event.pointerId) emitPlacement(event, false);
}

function endDrag(event) {
  if (dragPointerId !== event.pointerId) return;
  emitPlacement(event, true);
  dragPointerId = null;
}

function moveWithKeyboard(event) {
  const steps = {
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
  };
  const direction = steps[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 0.1 : 0.02;
  emit('placement-change', {
    commit: true,
    deltaXRatio: direction[0] * step,
    deltaYRatio: direction[1] * step,
  });
}

function emitPlacement(event, commit) {
  emit('placement-change', {
    clientX: event.clientX,
    clientY: event.clientY,
    commit,
  });
}

function progressStyle(badge) {
  return {
    width: `${badge.progressPercent}%`,
  };
}

function progressClass(badge) {
  return `atlas-static-progress-fill-${badge.progressTone}`;
}

function assetTypeFor(badge) {
  return assetTypes[badge.type] ?? assetTypes.image;
}

function handleBadgeShortcut(event) {
  const type = reactionFromBadgeShortcutEvent(event);

  if (type === null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  emit("react", type);
}
</script>

<template>
  <div
    data-atlas-asset-badge="true"
    :data-atlas-asset-source="badge.source"
    :style="badge.style"
    @click="handleBadgeShortcut"
    @contextmenu="handleBadgeShortcut"
    @mousedown="handleBadgeShortcut"
  >
    <button
      type="button"
      class="atlas-static-drag-handle"
      aria-label="Move Atlas widget"
      title="Move Atlas widget"
      @keydown.stop="moveWithKeyboard"
      @pointerdown.stop.prevent="beginDrag"
      @pointermove.stop.prevent="continueDrag"
      @pointerup.stop.prevent="endDrag"
      @pointercancel.stop.prevent="endDrag"
    >
      <GripHorizontal :size="16" :stroke-width="2" />
    </button>
    <div class="atlas-static-meta">
      <span
        class="atlas-static-asset-kind"
        :title="assetTypeFor(badge).label"
      >
        <component
          :is="assetTypeFor(badge).icon"
          :size="metaIconSize"
          :stroke-width="2"
        />
        <span v-if="badge.resolutionLabel">{{ badge.resolutionLabel }}</span>
      </span>
      <span
        v-if="badge.timestampLabel"
        class="atlas-static-timestamp"
      >{{ badge.timestampLabel }}</span>
    </div>

    <div
      v-if="badge.batch?.available || badge.closeTab?.available"
      class="atlas-static-controls"
    >
      <label
        v-if="badge.batch?.available"
        class="atlas-static-batch"
        title="Queue every file in this post"
      >
        <input
          type="checkbox"
          :checked="badge.batch.checked"
          :disabled="badge.isBusy || badge.isDeleting"
          @change.stop="$emit('batch-toggle', $event.target.checked)"
          @click.stop
        >
        <span>Batch</span>
      </label>
      <div
        v-if="badge.closeTab?.available"
        class="atlas-static-close-mode"
        role="group"
        aria-label="Close tab mode"
        title="Close tab mode"
      >
        <button
          v-for="item in closeModeOptions"
          :key="item.value"
          type="button"
          class="atlas-static-close-mode-option"
          :class="{ 'atlas-static-close-mode-option-active': badge.closeTab.mode === item.value }"
          :disabled="badge.isBusy || badge.isDeleting"
          :aria-label="item.label"
          :title="item.label"
          @click.stop.prevent="$emit('close-mode-change', item.value)"
        >
          {{ item.shortLabel }}
        </button>
      </div>
    </div>

    <div class="atlas-static-icons">
      <button
        v-for="reaction in reactions"
        :key="reaction.type"
        type="button"
        class="atlas-static-icon"
        :class="{
          'atlas-static-icon-active': badge.activeReaction === reaction.type,
          [`atlas-static-icon-${reaction.type}`]: true,
        }"
        :disabled="badge.isBusy || badge.isDeleting"
        :aria-label="reaction.label"
        :title="reaction.label"
        @click.stop.prevent="$emit('react', reaction.type)"
      >
        <LoaderCircle
          v-if="badge.submittingReaction === reaction.type"
          class="atlas-static-spinner"
          :size="iconSize"
          :stroke-width="2"
        />
        <component
          v-else
          :is="reaction.icon"
          :size="iconSize"
          :stroke-width="2"
        />
      </button>

      <button
        v-if="badge.canOpenFile"
        type="button"
        class="atlas-static-file-action"
        :disabled="badge.isBusy || badge.isDeleting"
        aria-label="Open file in Atlas"
        title="Open file in Atlas"
        @click.stop.prevent="emit('open-file')"
      >
        <ExternalLink
          :size="iconSize"
          :stroke-width="2"
        />
      </button>

      <button
        v-if="badge.canDeleteFile"
        type="button"
        class="atlas-static-file-action atlas-static-file-action-danger"
        :disabled="badge.isBusy || badge.isDeleting"
        aria-label="Delete downloaded file from Atlas"
        title="Delete downloaded file from Atlas"
        @click.stop.prevent="$emit('delete')"
      >
        <LoaderCircle
          v-if="badge.isDeleting"
          class="atlas-static-spinner"
          :size="iconSize"
          :stroke-width="2"
        />
        <Trash2
          v-else
          :size="iconSize"
          :stroke-width="2"
        />
      </button>
    </div>

    <div class="atlas-static-progress">
      <div
        class="atlas-static-progress-fill"
        :class="progressClass(badge)"
        :style="progressStyle(badge)"
      ></div>
      <div
        v-if="badge.progressLabel"
        class="atlas-static-progress-text"
      >
        {{ badge.progressLabel }}
      </div>
    </div>
    <p
      v-if="badge.closeTabError"
      class="atlas-static-close-error"
      role="status"
    >
      Could not close tab: {{ badge.closeTabError }}
    </p>
    <p
      v-if="badge.widgetPlacementError"
      class="atlas-static-close-error"
      role="status"
    >
      {{ badge.widgetPlacementError }}
    </p>
  </div>
</template>
