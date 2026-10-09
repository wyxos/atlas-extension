<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { CircleOff, Link2, RefreshCw, Unplug } from "@lucide/vue";
import { toast } from "vue-sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui/alert-dialog";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import {
  cancelDesktopPairing,
  requestDesktopDiagnostics,
  requestDesktopPairing,
  requestDesktopReconnect,
  requestDesktopUnpair,
} from "../../shared/desktop-messages";
import { desktopConnectionStorageKey } from "../../background/desktop-connection-state";
import { createReactionFailureHistory } from "../../background/reaction-diagnostics.js";

const diagnostics = ref(null);
const reactionFailures = ref([]);
const failureHistory = createReactionFailureHistory();
const busyAction = ref("");
let pairingCancelled = false;

const isBusy = computed(() => busyAction.value !== "");
const isPairing = computed(() => busyAction.value === "pair" || diagnostics.value?.pairingPending === true);
const statusLabel = computed(() => ({
  connected: "Connected",
  error: "Needs attention",
  offline: "Desktop offline",
  unpaired: "Not paired",
})[diagnostics.value?.health] ?? "Checking");
const statusVariant = computed(() => ({
  connected: "success",
  error: "danger",
  offline: "outline",
  unpaired: "outline",
})[diagnostics.value?.health] ?? "outline");
const diagnosticRows = computed(() => [
  ["Channel", diagnostics.value?.channel],
  ["Desktop endpoint", diagnostics.value?.baseUrl],
  ["Protocol", diagnostics.value?.protocolVersion],
  ["Desktop version", diagnostics.value?.app?.version],
  ["Extension version", diagnostics.value?.extensionVersion],
  ["Client ID", diagnostics.value?.clientId],
  ["Event stream", diagnostics.value?.eventStatus],
  ["Event connected", formatTimestamp(diagnostics.value?.eventConnectedAt)],
  ["Last event received", formatTimestamp(diagnostics.value?.lastEventAt)],
  ["Last keepalive", formatTimestamp(diagnostics.value?.lastHeartbeatAt)],
  ["Reconnect attempt", diagnostics.value?.reconnectAttempt],
  ["Last event sequence", diagnostics.value?.eventSequence],
  ["Runtime policy revision", diagnostics.value?.runtimePolicyRevision],
  ["Last checked", formatTimestamp(diagnostics.value?.lastCheckedAt)],
]);

function handleStorageChange(changes, areaName) {
  if (areaName === "local" && changes?.atlasReactionFailures) void loadFailureHistory();
  if (areaName === "local" && changes?.[desktopConnectionStorageKey]) {
    void loadDiagnostics();
  }
}

onMounted(() => {
  globalThis.chrome?.storage?.onChanged?.addListener?.(handleStorageChange);
  void loadDiagnostics();
  void loadFailureHistory();
});

async function loadFailureHistory() {
  try { reactionFailures.value = (await failureHistory.snapshot()).reverse(); }
  catch { reactionFailures.value = []; }
}
onBeforeUnmount(() => {
  globalThis.chrome?.storage?.onChanged?.removeListener?.(handleStorageChange);
});

async function loadDiagnostics() {
  try {
    diagnostics.value = await requestDesktopDiagnostics();
  } catch (error) {
    toast.error("Diagnostics unavailable.", { description: error.message });
  }
}

async function reconnect() {
  await runAction("reconnect", requestDesktopReconnect, "Desktop connection refreshed.");
}

async function pair() {
  pairingCancelled = false;
  await runAction("pair", requestDesktopPairing, "Extension paired with Atlas Desktop.", {
    suppressError: () => pairingCancelled,
  });
}

async function cancelPairing() {
  pairingCancelled = true;

  try {
    diagnostics.value = await cancelDesktopPairing();
  } catch (error) {
    toast.error("Pairing could not be cancelled.", { description: error.message });
  }
}

async function unpair() {
  await runAction("unpair", requestDesktopUnpair, "Desktop pairing removed.");
}

async function runAction(action, callback, successMessage, options = {}) {
  busyAction.value = action;

  try {
    diagnostics.value = await callback();
    toast.success(successMessage);
  } catch (error) {
    await loadDiagnostics();

    if (!options.suppressError?.()) {
      toast.error(actionErrorTitle(action), { description: error.message });
    }
  } finally {
    busyAction.value = "";
  }
}

function actionErrorTitle(action) {
  return ({
    pair: "Pairing failed.",
    reconnect: "Desktop is unavailable.",
    unpair: "Pairing could not be removed.",
  })[action] ?? "Desktop request failed.";
}

function formatTimestamp(value) {
  if (typeof value !== "string" || value === "") {
    return null;
  }

  return new Date(value).toLocaleString();
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}
</script>

<template>
  <section class="space-y-5" aria-labelledby="desktop-diagnostics-title">
    <div class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="desktop-diagnostics-title" class="text-lg font-semibold">
            Atlas Desktop
          </h2>
          <Badge :variant="statusVariant" aria-live="polite">
            {{ statusLabel }}
          </Badge>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">
          The extension accepts only the matching Desktop channel on this computer.
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          v-if="!diagnostics?.paired && !isPairing"
          size="sm"
          :disabled="isBusy"
          @click="pair"
        >
          <Link2 data-icon="inline-start" />
          Pair
        </Button>
        <Button
          v-if="isPairing"
          size="sm"
          variant="outline"
          @click="cancelPairing"
        >
          <CircleOff data-icon="inline-start" />
          Cancel pairing
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="isBusy"
          @click="reconnect"
        >
          <RefreshCw data-icon="inline-start" :class="{ 'animate-spin': busyAction === 'reconnect' }" />
          Reconnect
        </Button>

        <AlertDialog v-if="diagnostics?.paired">
          <AlertDialogTrigger as-child>
            <Button size="sm" variant="outline" :disabled="isBusy">
              <Unplug data-icon="inline-start" />
              Unpair
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this browser pairing?</AlertDialogTitle>
              <AlertDialogDescription>
                Atlas actions will remain unavailable until Desktop approves a new pairing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep pairing</AlertDialogCancel>
              <AlertDialogAction @click="unpair">
                Remove pairing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>

    <div
      v-if="diagnostics?.lastError"
      class="rounded-lg border border-destructive/40 bg-destructive/10 p-4"
      role="alert"
    >
      <p class="font-medium text-destructive">
        {{ diagnostics.lastError.message }}
      </p>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ diagnostics.lastError.retryable ? "Reconnect after Atlas Desktop is ready." : "Check the channel and pairing in Atlas Desktop." }}
      </p>
    </div>

    <section class="space-y-3" aria-labelledby="reaction-failures-title">
      <h3 id="reaction-failures-title" class="text-base font-semibold">
        Reaction failures
      </h3>
      <p v-if="!reactionFailures.length" class="text-sm text-muted-foreground">
        No recent reaction failures.
      </p>
      <ol v-else class="space-y-2">
        <li v-for="failure in reactionFailures" :key="failure.requestId" class="min-w-0 rounded-sm border border-border bg-card p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="break-all text-sm font-medium">{{ failure.code }}</span>
            <Badge variant="outline" class="rounded-sm">
              {{ failure.delivered ? "Recorded in Desktop" : "Pending Desktop connection" }}
            </Badge>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ formatTimestamp(failure.observedAt) }} · {{ failure.operation }} · {{ failure.phase }}
          </p>
          <p class="mt-2 break-all font-mono text-xs">
            Reference: {{ failure.requestId }}
          </p>
        </li>
      </ol>
    </section>

    <dl class="grid grid-cols-1 overflow-hidden rounded-lg border border-border sm:grid-cols-2">
      <div
        v-for="([label, value], index) in diagnosticRows"
        :key="label"
        class="min-w-0 border-border p-4 sm:[&:nth-child(odd)]:border-r"
        :class="{ 'border-b': index < diagnosticRows.length - 2 }"
      >
        <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {{ label }}
        </dt>
        <dd class="mt-1 break-words text-sm font-medium">
          {{ displayValue(value) }}
        </dd>
      </div>
    </dl>
  </section>
</template>
