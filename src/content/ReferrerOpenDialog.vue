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

function titleFor(request) {
  return request?.reason === "reacted"
    ? "Referrer already reacted"
    : "Referrer already open";
}

function descriptionFor(request) {
  return request?.reason === "reacted"
    ? "Atlas already has a reaction for this referrer."
    : "This referrer is already open in another tab.";
}

</script>

<template>
  <ExtensionDialog
    :open="request !== null"
    :portal-target="portalTarget"
    :title="titleFor(request)"
    :description="descriptionFor(request)"
    @cancel="emit('resolve', false)"
  >
    <div class="atlas-referrer-open-url">
      {{ request?.url }}
    </div>

    <div data-slot="alert-dialog-footer">
      <button
        data-slot="alert-dialog-cancel"
        data-autofocus
        type="button"
        @click="emit('resolve', false)"
      >
        Cancel
      </button>
      <button
        data-slot="alert-dialog-action"
        type="button"
        @click="emit('resolve', true)"
      >
        Open anyway
      </button>
    </div>
  </ExtensionDialog>
</template>
