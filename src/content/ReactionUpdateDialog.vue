<script setup>
import ExtensionDialog from "./ExtensionDialog.vue";

defineProps({
  portalTarget: {
    type: null,
    required: false,
  },
  request: {
    type: Object,
    required: false,
    default: null,
  },
});

const emit = defineEmits(["resolve"]);

const reactionLabels = {
  blacklist: "blacklist",
  funny: "funny",
  like: "like",
  love: "love",
};

function reactionLabel(value) {
  return reactionLabels[value] ?? "reaction";
}

function descriptionFor(request) {
  if (request?.kind === 'provider-fallback') {
    return 'CivitAI could not return this item. Use the existing Atlas item when available, or save the browser media without CivitAI metadata.';
  }
  const current = reactionLabel(request?.currentReaction);
  const next = reactionLabel(request?.nextReaction);

  return `This asset already has a ${current} reaction. Choose whether to change it to ${next} only, or queue a fresh download too.`;
}

</script>

<template>
  <ExtensionDialog
    :open="request !== null"
    :portal-target="portalTarget"
    :title="request?.kind === 'provider-fallback' ? 'Continue without CivitAI?' : 'Update reaction?'"
    :description="descriptionFor(request)"
    @cancel="emit('resolve', 'cancel')"
  >
    <div data-slot="alert-dialog-footer">
      <button
        data-slot="alert-dialog-cancel"
        data-autofocus
        type="button"
        @click="emit('resolve', 'cancel')"
      >
        Cancel
      </button>
      <button
        data-slot="alert-dialog-action"
        type="button"
        v-if="request?.kind !== 'provider-fallback'"
        @click="emit('resolve', 'update-only')"
      >
        Update reaction only
      </button>
      <button
        data-slot="alert-dialog-action"
        type="button"
        @click="emit('resolve', request?.kind === 'provider-fallback' ? 'browser-download' : 'redownload')"
      >
        {{ request?.kind === 'provider-fallback' ? 'Continue without CivitAI' : 'React + redownload' }}
      </button>
    </div>
  </ExtensionDialog>
</template>
