<script setup>
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const props = defineProps({
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

function handleOpenChange(open) {
  if (!open && props.request !== null) {
    emit("resolve", false);
  }
}
</script>

<template>
  <AlertDialog
    :open="request !== null"
    @update:open="handleOpenChange"
  >
    <AlertDialogContent :portal-to="portalTarget">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ titleFor(request) }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ descriptionFor(request) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="atlas-referrer-open-url">
        {{ request?.url }}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel @click="emit('resolve', false)">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction @click="emit('resolve', true)">
          Open anyway
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
