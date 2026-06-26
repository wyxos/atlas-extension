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
  const current = reactionLabel(request?.currentReaction);
  const next = reactionLabel(request?.nextReaction);

  return `This asset already has a ${current} reaction. Choose whether to change it to ${next} only, or queue a fresh download too.`;
}

function handleOpenChange(open) {
  if (!open && props.request !== null) {
    window.setTimeout(() => {
      if (props.request !== null) {
        emit("resolve", "cancel");
      }
    }, 0);
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
        <AlertDialogTitle>Update reaction?</AlertDialogTitle>
        <AlertDialogDescription>
          {{ descriptionFor(request) }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel @click="emit('resolve', 'cancel')">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction @click="emit('resolve', 'update-only')">
          Update reaction only
        </AlertDialogAction>
        <AlertDialogAction @click="emit('resolve', 'redownload')">
          React + redownload
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
