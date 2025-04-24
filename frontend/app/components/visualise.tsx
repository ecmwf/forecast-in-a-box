
import { useState } from "react";
import { SubmitSpecification } from "./interface";
import { ActionIcon, Button, Container, Group, Menu } from "@mantine/core";
import GraphModal from "./shared/graphModal";

import {IconMenu2} from '@tabler/icons-react';

interface GraphVisualiserProps {
    spec: SubmitSpecification | null;
    url: string | null;
}

export default function GraphVisualiser({ spec, url }: GraphVisualiserProps) {
    const [graphContent, setGraphContent] = useState<string>("");
    const [loading, setLoading] = useState(false);

    const getGraph = (options: { preset: string }) => {
        const getGraphHtml = async () => {
            setLoading(true);
            (async () => {
                try {
                    console.log(options);
                    let response: Response;
                    if (spec) {
                        response = await fetch(`/api/py/graph/visualise`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ spec: spec, options: options }),
                        });
                    } else if (url) {
                        response = await fetch(`${url}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ spec: spec, options: options }),
                        });
                    } else {
                        throw new Error("No valid source for fetching the graph.");
                    }
                    const graph: string = await response.text();
                    setGraphContent(graph);
                } catch (error) {
                    console.error("Error getting graph:", error);
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