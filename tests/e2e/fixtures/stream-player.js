/* global Blob, MediaSource */
// Plays a WebM through Media Source Extensions (currentSrc becomes blob:),
// falling back to a plain blob: URL where MSE cannot take the file.
export async function playAsStream(video, url) {
  const bytes = await (await fetch(url)).arrayBuffer();
  const type = 'video/webm; codecs="vp8"';
  if (globalThis.MediaSource?.isTypeSupported(type)) {
    const source = new MediaSource();
    video.src = URL.createObjectURL(source);
    await new Promise(resolve => source.addEventListener('sourceopen', resolve, { once: true }));
    const buffer = source.addSourceBuffer(type);
    buffer.appendBuffer(bytes);
    await new Promise(resolve => buffer.addEventListener('updateend', resolve, { once: true }));
    source.endOfStream();
    video.dataset.stream = 'mse';
  } else {
    video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    video.dataset.stream = 'blob';
  }
}
