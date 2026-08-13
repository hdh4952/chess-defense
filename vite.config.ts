import { defineConfig } from 'vite';

// GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 하위 경로에서 서빙되므로
// 기본값인 절대 경로(/assets/...)로 빌드하면 자산을 찾지 못한다. 상대 경로로 빌드하면
// 저장소 이름이 바뀌거나 dist를 로컬에서 직접 열어도 그대로 동작한다.
export default defineConfig({
  base: './',
});
