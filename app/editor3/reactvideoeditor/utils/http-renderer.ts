import { VideoRenderer, RenderParams, RenderResponse, ProgressParams, ProgressResponse, RenderTypeInfo } from "../types/renderer";

/**
 * HTTP-based video renderer implementation
 */
export class HttpRenderer implements VideoRenderer {
  private endpoint: string;
  private renderTypeInfo: RenderTypeInfo;

  constructor(endpoint: string, renderType: RenderTypeInfo) {
    this.endpoint = endpoint;
    this.renderTypeInfo = renderType;
  }

  private normalizeParams(params: RenderParams): RenderParams {
    const clone: RenderParams = JSON.parse(JSON.stringify(params || {}));
    const props: any = clone?.inputProps || {};
    if (Array.isArray(props.overlays)) {
      props.overlays = props.overlays.map((o: any) => {
        const originalSrc = o?.meta?.originalSrc || o?.src;
        return { ...o, src: originalSrc };
      });
    }
    if (props?.audio && typeof props.audio === "object" && (props.audio as any).src) {
      const audioSrc = (props.audio as any).meta?.originalSrc || (props.audio as any).src;
      props.audio = { ...(props.audio as any), src: audioSrc };
    }
    clone.inputProps = props;
    return clone;
  }

  async renderVideo(params: RenderParams): Promise<RenderResponse> {
    const normalized = this.normalizeParams(params);
    const response = await fetch(`${this.endpoint}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(normalized),
    });

    if (!response.ok) {
      throw new Error(`Render request failed: ${response.statusText}`);
    }

    const responseData = await response.json();
    
    // Handle different response structures
    // Lambda renderer wraps response in { type: "success", data: ... }
    // SSR renderer returns response directly
    if (responseData.type === "success" && responseData.data) {
      return responseData.data;
    }
    
    // Direct response (SSR)
    return responseData;
  }

  async getProgress(params: ProgressParams): Promise<ProgressResponse> {
    const response = await fetch(`${this.endpoint}/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Progress request failed: ${response.statusText}`);
    }

    const responseData = await response.json();
    
    // Handle different response structures
    // Lambda renderer wraps response in { type: "success", data: ... }
    // SSR renderer returns response directly
    if (responseData.type === "success" && responseData.data) {
      return responseData.data;
    }
    
    // Direct response (SSR)
    return responseData;
  }

  get renderType(): RenderTypeInfo {
    return this.renderTypeInfo;
  }
} 