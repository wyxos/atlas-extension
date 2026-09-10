<script>
let nextDialogId = 0;
</script>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const props = defineProps({
  description: {
    type: String,
    required: true,
  },
  open: {
    type: Boolean,
    required: true,
  },
  portalTarget: {
    type: null,
    required: false,
  },
  title: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["cancel"]);
const dialog = ref(null);
const modal = ref(null);
nextDialogId += 1;
const instanceId = nextDialogId;
const titleId = `atlas-extension-dialog-title-${instanceId}`;
const descriptionId = `atlas-extension-dialog-description-${instanceId}`;
let previousActiveElement = null;

watch(() => [props.open, props.title, props.description], async ([open]) => {
  if (open) {
    previousActiveElement ??= activeElementForDialog();
    await nextTick();
    if (!props.open || !modal.value) return;
    // Native modal dialogs occupy the browser top layer, above host-page
    // dialogs, popovers and all z-index stacking contexts.
    if (modal.value.open) modal.value.close();
    modal.value.showModal();
    focusInitialElement();
    return;
  }

  modal.value?.close();
  await nextTick();
  previousActiveElement?.focus?.({ preventScroll: true });
  previousActiveElement = null;
}, { immediate: true });

onBeforeUnmount(() => modal.value?.close());

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const focusableElements = getFocusableElements();

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.value?.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = activeElementForDialog();

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus({ preventScroll: true });
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  }
}

function focusInitialElement() {
  const autofocusElement = dialog.value?.querySelector("[data-autofocus]");
  const firstElement = autofocusElement ?? getFocusableElements()[0] ?? dialog.value;

  firstElement?.focus?.({ preventScroll: true });
}

function getFocusableElements() {
  return [...(dialog.value?.querySelectorAll(focusableSelector) ?? [])]
    .filter((element) => element.getClientRects().length > 0);
}

function activeElementForDialog() {
  const root = dialog.value?.getRootNode?.();

  return root?.activeElement ?? document.activeElement;
}
</script>

<template>
  <Teleport
    v-if="open"
    :to="portalTarget ?? 'body'"
    :disabled="portalTarget == null"
  >
    <dialog
      ref="modal"
      data-atlas-extension-dialog-root
      @cancel.prevent="emit('cancel')"
      @keydown.capture="handleKeydown"
    >
      <div
        data-slot="alert-dialog-overlay"
        @click="emit('cancel')"
      />
      <section
        ref="dialog"
        data-slot="alert-dialog-content"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
        @click.stop
      >
        <div data-slot="alert-dialog-header">
          <h2
            :id="titleId"
            data-slot="alert-dialog-title"
          >
            {{ title }}
          </h2>
          <p
            :id="descriptionId"
            data-slot="alert-dialog-description"
          >
            {{ description }}
          </p>
        </div>

        <slot />
      </section>
    </dialog>
  </Teleport>
</template>
