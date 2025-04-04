
import React, { useState } from 'react';
import { Modal, Center} from '@mantine/core';


import Loader from '../animations/loader'


function GraphModal({ graphContent, setGraphContent, loading }: { graphContent: string, setGraphContent: (content: string) => void, loading: boolean }) {
    return (
        <Modal
            opened={!!graphContent || loading}
            onClose={() => setGraphContent("")}
            title={loading ? "Loading..." : "Graph"}
            size={loading ? "xs" : "70vw"}
        >
            {loading && <Center><Loader /></Center>}
            {!loading && graphContent &&
                <iframe
                    srcDoc={graphContent} // Use srcDoc to inject the full HTML document
                    style={{ width: "100%", height: "60vh", border: "none" }}
                />
            }
        </Modal>
    );
}

export default GraphModal;