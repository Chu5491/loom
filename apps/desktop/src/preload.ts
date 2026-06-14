// contextIsolation 유지용 프리로드. 렌더러는 같은 오리진 http API(/api)만 쓰므로
// 지금은 노출할 네이티브 브리지가 없다. 추후 OS 연동(파일 picker 등)이 필요하면
// 여기서 contextBridge.exposeInMainWorld 로 좁게 노출한다.
export {};
