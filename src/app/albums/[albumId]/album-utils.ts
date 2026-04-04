export interface AlbumPhoto {
  id: string;
  originalName: string;
  url: string;
  originalUrl?: string;
  isReturn?: boolean;
  isSelected?: boolean;
  isBlurred?: boolean;
  imageHash?: string | null;
  createdAt?: string;
}

export interface DuplicateGroup {
  keep: AlbumPhoto;
  duplicates: AlbumPhoto[];
}

export function buildDuplicateGroups(photos: AlbumPhoto[], threshold: number) {
  if (photos.length < 2) {
    return [] as DuplicateGroup[];
  }

  const usable = photos.filter((photo): photo is AlbumPhoto & { imageHash: string } => Boolean(photo.imageHash));
  const visited = new Set<string>();
  const photoMap = new Map(usable.map((photo) => [photo.id, photo]));
  const adjacency = new Map<string, Set<string>>();

  for (const photo of usable) {
    adjacency.set(photo.id, new Set());
  }

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (hammingDistance(usable[i].imageHash, usable[j].imageHash) <= threshold) {
        adjacency.get(usable[i].id)?.add(usable[j].id);
        adjacency.get(usable[j].id)?.add(usable[i].id);
      }
    }
  }

  const groups: DuplicateGroup[] = [];

  for (const photo of usable) {
    if (visited.has(photo.id)) continue;

    const queue = [photo.id];
    const component: AlbumPhoto[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentPhoto = photoMap.get(currentId);
      if (!currentPhoto) continue;
      component.push(currentPhoto);

      for (const neighbor of adjacency.get(currentId) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (component.length > 1) {
      const ordered = [...component].sort(
        (left, right) =>
          new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime()
      );
      groups.push({ keep: ordered[0], duplicates: ordered.slice(1) });
    }
  }

  return groups.sort((left, right) => right.duplicates.length - left.duplicates.length);
}

function hammingDistance(left: string, right: string) {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;

  while (value > BigInt(0)) {
    count += Number(value & BigInt(1));
    value >>= BigInt(1);
  }

  return count;
}
