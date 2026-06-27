<script setup>
import {
  Ban,
  ExternalLink,
  Heart,
  ImageIcon,
  LoaderCircle,
  Smile,
  ThumbsUp,
  Trash2,
  Video,
  Volume2,
} from "@lucide/vue";
import { closeTabModes } from "../shared/close-tab-preferences.js";

defineProps({
  badge: {
    type: Object,
    required: true,
  },
});

defineEmits(["batch-toggle", "close-mode-change", "delete", "react"]);

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
</script>

<template>
  <div
    data-atlas-asset-badge="true"
    :data-atlas-asset-source="badge.source"
    :style="badge.style"
  >
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

      <a
        v-if="badge.atlasFileUrl"
        class="atlas-static-file-action"
        :href="badge.atlasFileUrl"
        target="_blank"
        rel="noreferrer"
        aria-label="Open file in Atlas"
        title="Open file in Atlas"
        @click.stop
      >
        <ExternalLink
          :size="iconSize"
          :stroke-width="2"
        />
      </a>

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
  </div>
</template>
