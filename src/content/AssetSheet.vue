<script setup>
import {
  Ban,
  Heart,
  ImageIcon,
  Images,
  LoaderCircle,
  Smile,
  ThumbsUp,
  Video,
  Volume2,
  X,
} from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { listReactionSheetAssets } from "./asset-sheet-model.js";
import { reactionFromBadgeShortcutEvent } from "./asset-shortcuts.js";
import AssetSheetPreview from "./AssetSheetPreview.vue";

const props = defineProps({
  badges: {
    type: Array,
    required: true,
  },
  portalTarget: {
    type: null,
    required: true,
  },
});

const emit = defineEmits(["react"]);
const isOpen = ref(false);
const closeButton = ref(null);
const sheetPanel = ref(null);
const triggerButton = ref(null);
let originalDocumentOverflow = null;

const uniqueAssets = computed(() => {
  return listReactionSheetAssets(props.badges);
});

const assetTypes = {
  audio: { icon: Volume2, label: "Audio" },
  image: { icon: ImageIcon, label: "Image" },
  video: { icon: Video, label: "Video" },
};

const reactions = [
  { icon: Heart, label: "Love", type: "love" },
  { icon: ThumbsUp, label: "Like", type: "like" },
  { icon: Ban, label: "Blacklist", type: "blacklist" },
  { icon: Smile, label: "Funny", type: "funny" },
];

watch(isOpen, async (open) => {
  if (open) {
    lockDocumentScroll();
    await nextTick();
    closeButton.value?.focus();

    return;
  }

  restoreDocumentScroll();
});

watch(() => uniqueAssets.value.length, (assetCount) => {
  if (assetCount === 0 && isOpen.value) {
    closeSheet({ restoreFocus: false });
  }
});

onBeforeUnmount(restoreDocumentScroll);

function closeSheet({ restoreFocus = true } = {}) {
  isOpen.value = false;

  if (restoreFocus) {
    nextTick(() => triggerButton.value?.focus());
  }
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSheet();

    return;
  }

  if (event.key === "Tab") {
    keepFocusInSheet(event);
  }
}

function handleCardShortcut(event, asset) {
  const type = reactionFromBadgeShortcutEvent(event);

  if (type === null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  emit("react", { id: asset.id, type });
}

function keepFocusInSheet(event) {
  const focusable = [...(sheetPanel.value?.querySelectorAll?.(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  ) ?? [])];

  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = sheetPanel.value?.getRootNode?.()?.activeElement;

  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function lockDocumentScroll() {
  if (originalDocumentOverflow !== null) {
    return;
  }

  originalDocumentOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
}

function restoreDocumentScroll() {
  if (originalDocumentOverflow === null) {
    return;
  }

  document.documentElement.style.overflow = originalDocumentOverflow;
  originalDocumentOverflow = null;
}

function assetTypeFor(asset) {
  return assetTypes[asset.type] ?? assetTypes.image;
}

function sourceLabel(asset) {
  try {
    const url = new URL(asset.source);
    const fileName = url.pathname.split("/").filter(Boolean).pop();

    return fileName ? `${url.hostname}/${fileName}` : url.hostname;
  } catch {
    return asset.source;
  }
}
</script>

<template>
  <button
    v-if="uniqueAssets.length > 0"
    ref="triggerButton"
    type="button"
    class="atlas-asset-sheet-trigger"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    aria-controls="atlas-asset-sheet"
    @click="isOpen = true"
  >
    <Images :size="18" :stroke-width="2" />
    <span>Assets</span>
    <span class="atlas-asset-sheet-count">{{ uniqueAssets.length }}</span>
  </button>

  <Teleport :to="portalTarget">
    <Transition name="atlas-asset-sheet-fade">
      <div
        v-if="isOpen"
        class="atlas-asset-sheet-overlay"
        @click.self="closeSheet()"
      >
        <section
          id="atlas-asset-sheet"
          ref="sheetPanel"
          class="atlas-asset-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="atlas-asset-sheet-title"
          @keydown="handleKeydown"
        >
          <header class="atlas-asset-sheet-header">
            <div>
              <h2 id="atlas-asset-sheet-title">
                Recognized assets
              </h2>
              <p>{{ uniqueAssets.length }} available for reactions</p>
            </div>
            <button
              ref="closeButton"
              type="button"
              class="atlas-asset-sheet-close"
              aria-label="Close recognized assets"
              @click="closeSheet()"
            >
              <X :size="20" :stroke-width="2" />
            </button>
          </header>

          <div class="atlas-asset-sheet-list">
            <article
              v-for="asset in uniqueAssets"
              :key="asset.source"
              class="atlas-asset-sheet-item"
              @click="handleCardShortcut($event, asset)"
              @contextmenu="handleCardShortcut($event, asset)"
              @mousedown="handleCardShortcut($event, asset)"
            >
              <AssetSheetPreview :asset="asset" />
              <div class="atlas-asset-sheet-item-meta">
                <span class="atlas-asset-sheet-kind">
                  <component
                    :is="assetTypeFor(asset).icon"
                    :size="18"
                    :stroke-width="2"
                  />
                  {{ assetTypeFor(asset).label }}
                  <span v-if="asset.resolutionLabel">{{ asset.resolutionLabel }}</span>
                </span>
                <span class="atlas-asset-sheet-source" :title="asset.source">
                  {{ sourceLabel(asset) }}
                </span>
              </div>

              <div class="atlas-asset-sheet-reactions" role="group" :aria-label="`React to ${assetTypeFor(asset).label.toLowerCase()}`">
                <button
                  v-for="reaction in reactions"
                  :key="reaction.type"
                  type="button"
                  class="atlas-asset-sheet-reaction"
                  :class="{
                    'atlas-asset-sheet-reaction-active': asset.activeReaction === reaction.type,
                    [`atlas-asset-sheet-reaction-${reaction.type}`]: true,
                  }"
                  :disabled="asset.isBusy || asset.isDeleting"
                  :aria-pressed="asset.activeReaction === reaction.type"
                  :aria-label="reaction.label"
                  :title="reaction.label"
                  @click="emit('react', { id: asset.id, type: reaction.type })"
                >
                  <LoaderCircle
                    v-if="asset.submittingReaction === reaction.type"
                    class="atlas-static-spinner"
                    :size="18"
                    :stroke-width="2"
                  />
                  <component
                    :is="reaction.icon"
                    v-else
                    :size="18"
                    :stroke-width="2"
                  />
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
