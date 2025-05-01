
import { useState } from "react";
import { ExecutionSpecification } from "./interface";
import { ActionIcon, Button, Container, Group, Menu } from "@mantine/core";
import GraphModal from "./shared/graphModal";
import {useApi} from '@/app/api';

import {IconMenu2} from '@tabler/icons-react';

interface GraphVisualiserProps {
    spec: ExecutionSpecification | null;
    url: string | null;
}

export default function GraphVisualiser({ spec, url }: GraphVisualiserProps) {
    const [graphContent, setGraphContent] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const api = useApi();
    

    const getGraph = (options: { preset: string }) => {
        const getGraphHtml = async () => {
            setLoading(true);
            (async () => {
                try {
                    let response;
                    if (spec) {
                        response = await api.post(`/api/v1/graph/visualise`, { spec: spec, options: options });
                    } else if (url) {
                        response = await api.post(`${url}`, {options});
                    } else {
                        throw new Error("No valid source for fetching the graph.");
                    }
                    const graph: string = await response.data;
                    setGraphContent(graph);
                } catch (err) {
                    setGraphContent(err.response.data.detail);
                } finally {
                    setLoading(false);
                }
            })();
        };
        getGraphHtml();
    };
    return (
        <Container bg='orange' fluid style={{borderRadius:'4px', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}}>
            <Button color='orange' onClick={() => getGraph({ preset: "blob" })} disabled={loading}>
                {loading ? "Loading..." : "Visualise"}
            </Button>
            <Menu shadow="md" width={200}>
                    <Menu.Target>
                        <Button p='' color="orange"><IconMenu2/></Button>
                    </Menu.Target>

                    <Menu.Dropdown>
                        <Menu.Label>Presets</Menu.Label>
                        <Menu.Item onClick={() => { getGraph({ preset: "blob" }); }}>
                        Blob
                        </Menu.Item>
                        <Menu.Item onClick={() => { getGraph({ preset: "hierarchical" }); }}>
                        Hierarchical
                        </Menu.Item>
                        <Menu.Item onClick={() => { getGraph({preset: "quick" }); }}>
                        Quick
                        </Menu.Item>
                        <Menu.Divider />
                    </Menu.Dropdown>
                    </Menu>
        <GraphModal graphContent={graphContent} setGraphContent={setGraphContent} loading={loading}/>
        </Container>
    )
}