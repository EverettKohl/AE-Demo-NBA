"use client";

import React from 'react';
import Link from 'next/link';

import { HttpRenderer } from './reactvideoeditor/pro/utils/http-renderer';
import { ReactVideoEditor } from './reactvideoeditor/pro/components/react-video-editor';
import { createPexelsVideoAdaptor } from './reactvideoeditor/pro/adaptors/pexels-video-adaptor';
import { createPexelsImageAdaptor } from './reactvideoeditor/pro/adaptors/pexels-image-adaptor';
import { SHOW_MOBILE_WARNING } from './constants';
import { CustomTheme } from './reactvideoeditor/pro/hooks/use-extended-theme-switcher';
import { MobileWarningModal } from './reactvideoeditor/pro/components/shared/mobile-warning-modal';
import { ProjectLoadConfirmModal } from './reactvideoeditor/pro/components/shared/project-load-confirm-modal';
import { useProjectStateFromUrl } from './reactvideoeditor/pro/hooks/use-project-state-from-url';

export default function SimplePage() {
  /**
   * A project ID represents a unique editing session or workspace for a user.
   * This must match the composition ID defined in the Remotion bundle.
   */
  const PROJECT_ID = "TestComponent";

  /**
   * Load project state from API via URL parameter.
   * Landing site saves project: overlays sent to API
   * Then navigates to: /editor?projectId=456
   * 
   * This hook fetches the project state and returns overlays, aspect ratio, and loading state.
   * If there's existing autosave data, user will be prompted via modal to choose.
   */
  const { overlays, aspectRatio, backgroundColor, isLoading, showModal, onConfirmLoad, onCancelLoad } = 
    useProjectStateFromUrl('projectId', PROJECT_ID);

  // Handle theme changes
  const handleThemeChange = (themeId: string) => {
    console.log('Theme changed to:', themeId);
    // You can add additional theme change logic here
  };

    // Define available themes - you can add more custom themes here
    const availableThemes: CustomTheme[] = [
      {
        id: 'rve',
        name: 'RVE',
        className: 'rve',
        color: '#3E8AF5'
      },
    ];
  

   // Default renderer uses NextJS API routes
   const ffmpegRenderer = React.useMemo(() => 
    new HttpRenderer('/api/render', {
      type: 'ffmpeg',
      entryPoint: '/api/render'
    }), []
  );

  // const lambdaRenderer = React.useMemo(() => 
  //   new HttpRenderer('/api/latest/lambda', {
  //     type: 'lambda',
  //     entryPoint: '/api/latest/lambda'
  //   }), []
  // );

  return (
    <div className="w-full h-full fixed inset-0">
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <Link
          href="/search"
          className="rounded-md bg-indigo-600/80 px-3 py-2 text-sm font-medium text-white shadow-sm backdrop-blur hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          Kill Bill Search
        </Link>
        <Link
          href="/editor3"
          className="rounded-md bg-black/70 px-3 py-2 text-sm font-medium text-white shadow-sm backdrop-blur hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          Open Editor 3
        </Link>
      </div>
      <MobileWarningModal show={SHOW_MOBILE_WARNING} />
      <ProjectLoadConfirmModal 
        isVisible={showModal}
        onConfirm={onConfirmLoad}
        onCancel={onCancelLoad}
      />
      <ReactVideoEditor
        projectId={PROJECT_ID}
        defaultOverlays={overlays as any}
        defaultAspectRatio={aspectRatio || undefined}
        defaultBackgroundColor={backgroundColor || undefined}
        isLoadingProject={isLoading}
        fps={30}
        renderer={ffmpegRenderer}
        disabledPanels={[]}
        availableThemes={availableThemes}
        defaultTheme="dark"
        adaptors={{
          video: [createPexelsVideoAdaptor('CEOcPegZJRoNztih7auwNoFZmIFTmlYoZTI0NgTRCUxkFhXORBhERORM')],
          images: [createPexelsImageAdaptor('CEOcPegZJRoNztih7auwNoFZmIFTmlYoZTI0NgTRCUxkFhXORBhERORM')],
        }}
        onThemeChange={handleThemeChange}
        showDefaultThemes={true}
        sidebarWidth="clamp(350px, 25vw, 500px)"        
        sidebarIconWidth="57.6px"
        showIconTitles={false}
      />
    </div>
  );
} 