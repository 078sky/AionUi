interface PetAPI {
  onStateChange: (cb: (state: string) => void) => void;
  onEyeMove: (cb: (data: { eyeDx: number; eyeDy: number; bodyDx: number; bodyRotate: number }) => void) => void;
  onResize: (cb: (size: number) => void) => void;
}

interface PetHitAPI {
  dragStart: () => void;
  dragEnd: () => void;
  click: (data: { side: string; count: number }) => void;
  contextMenu: () => void;
}

interface Window {
  petAPI: PetAPI;
  petHitAPI: PetHitAPI;
}
