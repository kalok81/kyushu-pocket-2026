// In-memory Storage: uploaded files by path (globalThis.__fakeFiles), so tests can see what was kept or deleted.
const files=globalThis.__fakeFiles??={};
export const getStorage=()=>({}),ref=(st,path)=>({path});
export async function uploadBytes(r,b){files[r.path]=b}
export async function deleteObject(r){delete files[r.path]}
export async function getBlob(r){if(!files[r.path])throw new Error('storage/object-not-found');return files[r.path]}
