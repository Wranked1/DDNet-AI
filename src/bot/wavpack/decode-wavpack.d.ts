export interface AudioData {
  channelData: Float32Array[];
  sampleRate: number;
}

interface WavpackDecoder {

  decode(data: Uint8Array | ArrayBuffer): AudioData;

  flush(): AudioData;
  free(): void;
}

export default function decode(src: ArrayBuffer | Uint8Array): Promise<AudioData>;

export function decoder(): Promise<WavpackDecoder>;
