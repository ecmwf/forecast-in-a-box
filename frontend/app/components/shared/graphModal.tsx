
import React from 'react';
import { Modal, Center} from '@mantine/core';


import Loader from '../animations/loader'


/**
 * GraphModal component displays a modal that either shows a loading state or renders
 * an iframe with the provided graph content. The modal is controlled by the `graphContent`
 * and `loading` props.
 *
 * @param {Object} props - The props for the GraphModal component.
 * @param {string} props.graphContent - The HTML content to be displayed inside the iframe.
 *                                      If empty, the modal will not render the iframe.
 * @param {(content: string) => void} props.setGraphContent - A function to update the graph content.
 *                                                            Used to close the modal by setting an empty string.
 * @param {boolean} props.loading - A flag indicating whether the modal should display a loading state.
 *
 * @returns {React.JSX.Element} The rendered GraphModal component.
 */
function GraphModal({ graphContent, setGraphContent, loading }: { graphContent: string, setGraphContent: (content: string) => void, loading: boolean }): React.JSX.Element {
    return (
        <Modal
            opened={!!graphContent || loading}
            onClose={() => setGraphContent("")}
            title={loading ? "Loading..." : "Graph"}
            size={loading ? "xs" : "xl"}
        >
            {loading && <Center><Loader /></Center>}
            {!loading && graphContent &&
                <iframe
                    srcDoc={graphContent} // Use srcDoc to inject the full HTML document
                    style={{ width: "100%", height: "70vh", border: "none" }}
                />
            }
        </Modal>
    );
}

export default GraphModal;