// Display-format names derived from file extensions, shared by the upload
// form and the premium-file picker.

export function extensionToFormat(ext: string): string {
  const map: Record<string, string> = {
    wav: "WAV",
    flac: "FLAC",
    aiff: "AIFF",
    aif: "AIFF",
    mp3: "MP3",
    ogg: "OGG",
    m4a: "M4A",
    aac: "AAC",
    opus: "OPUS",
    zip: "ZIP",
  };
  return map[ext.toLowerCase()] || ext.toUpperCase();
}
