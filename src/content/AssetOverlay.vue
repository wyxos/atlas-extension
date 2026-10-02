<script setup>
import AssetBadge from "./AssetBadge.vue";
import AssetSheet from "./AssetSheet.vue";
import ReactionUpdateDialog from "./ReactionUpdateDialog.vue";
import ReferrerAssetBadge from "./ReferrerAssetBadge.vue";
import ReferrerOpenDialog from "./ReferrerOpenDialog.vue";

defineProps({
  collectionActive: { type: Boolean, default: false },
  cancelInspection: { type: Function, default: null },
  errorMessage: { type: String, default: null },
  inspectReaction: { type: Function, default: null },
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

defineEmits(["dismiss-error", "batch-toggle", "close-mode-change", "confirm", "delete", "open-file", "placement-change", "react", "reaction-confirm"]);
</script>

<template>
  <Teleport :to="portalTarget" :disabled="!portalTarget">
    <div v-if="errorMessage" class="atlas-operation-error" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" aria-label="Dismiss error" @click="$emit('dismiss-error')">
        Dismiss
      </button>
    </div>
  </Teleport>
  <template
    v-for="badge in badges"
    :key="badge.id"
  >
    <Teleport
      v-if="badge.portalTarget"
      :to="badge.portalTarget"
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
        @open-file="$emit('open-file', { id: badge.id })"
        @placement-change="$emit('placement-change', { id: badge.id, ...$event })"
        @react="$emit('react', { id: badge.id, type: $event })"
      />
    </Teleport>
    <template v-else>
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
        @open-file="$emit('open-file', { id: badge.id })"
        @placement-change="$emit('placement-change', { id: badge.id, ...$event })"
        @react="$emit('react', { id: badge.id, type: $event })"
      />
    </template>
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
  <AssetSheet
    :collection-active="collectionActive"
    :cancel-inspection="cancelInspection"
    :inspect-reaction="inspectReaction"
    :badges="badges"
    :portal-target="portalTarget"
    @react="$emit('react', $event)"
  />
</template>
