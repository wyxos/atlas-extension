<script setup>
import { Info } from '@lucide/vue';
import { ref, watch } from 'vue';

const props = defineProps({
  asset: { type: Object, required: true },
  inspectReaction: { type: Function, required: true },
});
const open = ref(false);
const reaction = ref('love');
const downloadAction = ref(props.asset.activeReaction ? 'skip' : 'queue');
const useBrowserDownload = ref(false);
const payload = ref('');
const error = ref('');
const loading = ref(false);
let revision = 0;

async function refresh() {
  const requestRevision = ++revision;
  payload.value = '';
  error.value = '';
  if (!open.value) return;
  loading.value = true;
  try {
    const request = await props.inspectReaction({
      id: props.asset.id, type: reaction.value,
      downloadAction: reaction.value === 'blacklist' || downloadAction.value === 'queue'
        ? undefined : downloadAction.value,
      useBrowserDownload: useBrowserDownload.value,
    });
    if (requestRevision === revision) payload.value = JSON.stringify(request, null, 2);
  } catch (cause) {
    if (requestRevision === revision) error.value = cause?.message ?? 'Could not inspect this request.';
  } finally {
    if (requestRevision === revision) loading.value = false;
  }
}

watch([open, reaction, downloadAction, useBrowserDownload,
  () => props.asset.source, () => props.asset.batch?.checked], refresh);
watch(() => props.asset.activeReaction, (activeReaction) => {
  downloadAction.value = activeReaction ? 'skip' : 'queue';
});
</script>

<template>
  <details
    class="atlas-asset-request-info"
    @toggle="open = $event.target.open"
    @click.stop
    @mousedown.stop
    @contextmenu.stop
  >
    <summary><Info :size="14" /> Info · Request payload</summary>
    <template v-if="open">
      <p>Preview only. Nothing is sent to Atlas. Cookie values are masked. The request is rebuilt when you react.</p>
      <label>Reaction
        <select v-model="reaction">
          <option value="love">Love</option>
          <option value="like">Like</option>
          <option value="blacklist">Blacklist</option>
          <option value="funny">Funny</option>
        </select>
      </label>
      <label v-if="reaction !== 'blacklist'">Download
        <select v-model="downloadAction">
          <option v-if="!asset.activeReaction" value="queue">Queue download</option>
          <option value="skip">Update reaction only</option>
          <option value="force">React + redownload</option>
        </select>
      </label>
      <p v-if="asset.activeReaction">
        When reacting, Atlas asks whether to update only or redownload.
      </p>
      <p v-if="loading" role="status">
        Preparing payload…
      </p>
      <p v-if="error" role="alert">
        {{ error }}
      </p>
      <pre v-if="payload" tabindex="0" aria-label="Reaction request payload">{{ payload }}</pre>
      <button type="button" class="atlas-asset-sheet-reaction" :disabled="loading" @click="refresh">
        Refresh payload
      </button>
    </template>
  </details>
</template>
