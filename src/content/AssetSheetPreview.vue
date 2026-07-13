<script setup>
import {
  ImageIcon,
  LoaderCircle,
  Video,
  Volume2,
} from "@lucide/vue";
import { ref } from "vue";

const props = defineProps({
  asset: {
    type: Object,
    required: true,
  },
});

const isReady = ref(false);
const hasFailed = ref(false);

const fallbackIcons = {
  audio: Volume2,
  image: ImageIcon,
  video: Video,
};

function markFailed() {
  hasFailed.value = true;
}

function markReady() {
  isReady.value = true;
}

function fallbackIcon() {
  return fallbackIcons[props.asset.type] ?? ImageIcon;
}
</script>

<template>
  <div class="atlas-asset-sheet-preview">
    <LoaderCircle
      v-if="!isReady && !hasFailed && asset.type !== 'audio'"
      class="atlas-static-spinner atlas-asset-sheet-preview-loader"
      :size="20"
      :stroke-width="2"
      aria-label="Loading asset preview"
    />
    <img
      v-if="asset.type === 'image' && !hasFailed"
      class="atlas-asset-sheet-preview-media"
      :class="{ 'atlas-asset-sheet-preview-media-ready': isReady }"
      :src="asset.source"
      alt="Asset preview"
      loading="lazy"
      @error="markFailed"
      @load="markReady"
    >
    <video
      v-else-if="asset.type === 'video' && !hasFailed"
      class="atlas-asset-sheet-preview-media"
      :class="{ 'atlas-asset-sheet-preview-media-ready': isReady }"
      :src="asset.source"
      aria-label="Asset preview"
      muted
      playsinline
      preload="metadata"
      @error="markFailed"
      @loadedmetadata="markReady"
    />
    <component
      :is="fallbackIcon()"
      v-else
      class="atlas-asset-sheet-preview-fallback"
      :size="24"
      :stroke-width="1.75"
      aria-hidden="true"
    />
  </div>
</template>
