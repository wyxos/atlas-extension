<script setup>
import AssetBadge from "./AssetBadge.vue";
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
});

defineEmits(["confirm", "delete", "react"]);
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
      @delete="$emit('delete', { id: badge.id })"
      @react="$emit('react', { id: badge.id, type: $event })"
    />
  </template>
  <ReferrerOpenDialog
    :portal-target="portalTarget"
    :request="confirmRequest"
    @resolve="$emit('confirm', $event)"
  />
</template>
