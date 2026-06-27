<script setup>
import AssetBadge from "./AssetBadge.vue";
import ReactionUpdateDialog from "./ReactionUpdateDialog.vue";
import ReferrerAssetBadge from "./ReferrerAssetBadge.vue";
import ReferrerOpenDialog from "./ReferrerOpenDialog.vue";

defineProps({
  badges: {
    type: Array,
    required: true,
  },
  confirmRequest: {
    type: Object,
    required: false,
    default: null,
  },
  portalTarget: {
    type: null,
    required: false,
  },
  reactionRequest: {
    type: Object,
    required: false,
    default: null,
  },
});

defineEmits(["batch-toggle", "close-mode-change", "confirm", "delete", "react", "reaction-confirm"]);
</script>

<template>
  <template
    v-for="badge in badges"
    :key="badge.id"
  >
    <ReferrerAssetBadge
      v-if="badge.variant === 'referrer'"
      :badge="badge"
    />
    <AssetBadge
      v-else
      :badge="badge"
      @batch-toggle="$emit('batch-toggle', { id: badge.id, checked: $event })"
      @close-mode-change="$emit('close-mode-change', { mode: $event })"
      @delete="$emit('delete', { id: badge.id })"
      @react="$emit('react', { id: badge.id, type: $event })"
    />
  </template>
  <ReferrerOpenDialog
    :portal-target="portalTarget"
    :request="confirmRequest"
    @resolve="$emit('confirm', $event)"
  />
  <ReactionUpdateDialog
    :portal-target="portalTarget"
    :request="reactionRequest"
    @resolve="$emit('reaction-confirm', $event)"
  />
</template>
